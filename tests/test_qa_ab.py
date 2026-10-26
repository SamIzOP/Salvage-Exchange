"""Stage A/B QA against real loopback HTTP, not an in-process test client.

Run: .venv/Scripts/python.exe -m unittest discover -s tests -p test_qa_ab.py -v
Each class starts an isolated Uvicorn process and private SQLite database.
Artifacts contain synthetic players only; bearer keys are always redacted.
No balance parameters or dice outcomes are overridden in the full match.
"""
import copy
from decimal import Decimal, ROUND_HALF_UP
import json
import os
from pathlib import Path
import re
import secrets
import socket
import sqlite3
import subprocess
import sys
import time
import unittest

import httpx

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'docs' / 'qa'
PRIVATE = ROOT / 'data' / 'qa-ab'


def cents(value):
    return Decimal(str(value)).quantize(Decimal('.01'), rounding=ROUND_HALF_UP)


def scrub(value):
    return json.loads(re.sub(r'\b[a-f0-9]{64}\b', '[REDACTED_KEY]', json.dumps(value)))


class WireClient:
    def __init__(self, base, label, transcript):
        self.label = label
        self.key = secrets.token_hex(32)
        self.client = httpx.Client(base_url=base, timeout=15, trust_env=False,
                                  headers={'Authorization': 'Bearer ' + self.key})
        self.transcript = transcript
        self.counter = 0
        self.code = None

    def request(self, method, path, body=None, headers=None):
        response = self.client.request(method, path, json=body, headers=headers)
        try:
            content = response.json()
        except ValueError:
            content = response.text[:1000]
        self.transcript.append(scrub(dict(client=self.label, method=method, path=path,
            body=body, status=response.status_code, response=content,
            cache_control=response.headers.get('cache-control'))))
        return response

    def create(self):
        response = self.request('POST', '/api/rooms', {'name': self.label, 'rejoin_key': self.key})
        response.raise_for_status()
        self.code = response.json()['code']
        return response.json()

    def join(self, code):
        self.code = code
        response = self.request('POST', f'/api/rooms/{code}/join', {'name': self.label, 'rejoin_key': self.key})
        response.raise_for_status()
        return response.json()

    def view(self):
        response = self.request('GET', f'/api/rooms/{self.code}')
        response.raise_for_status()
        return response.json()

    def payload(self, kind, **extra):
        state = self.view()
        self.counter += 1
        return dict(kind=kind, request_id=f'{self.label}-{self.counter}',
                    round=state['round'], phase=state['phase'], **extra)

    def command(self, kind, **extra):
        body = self.payload(kind, **extra)
        response = self.request('POST', f'/api/rooms/{self.code}/commands', body)
        response.raise_for_status()
        return response.json()

    def preview(self, plan=None):
        response = self.request('POST', f'/api/rooms/{self.code}/preview',
                                dict(plan=plan or {}, rival_factor=1.))
        response.raise_for_status()
        return response.json()


class LiveServer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        EVIDENCE.mkdir(parents=True, exist_ok=True)
        PRIVATE.mkdir(parents=True, exist_ok=True)
        run = PRIVATE / f'{cls.__name__}-{secrets.token_hex(4)}'
        run.mkdir()
        cls.database = run / 'rooms.sqlite3'
        cls.transcript = []
        cls.connections = []
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
        cls.base = f'http://127.0.0.1:{port}'
        env = {**os.environ, 'SALVAGE_DB': str(cls.database),
               'ALLOWED_HOSTS': '127.0.0.1,localhost', 'ALLOWED_ORIGINS': cls.base}
        cls.server_log = (run / 'server.log').open('w', encoding='utf-8')
        cls.process = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'server.app:app',
            '--host', '127.0.0.1', '--port', str(port), '--no-access-log'], cwd=ROOT, env=env,
            stdout=cls.server_log, stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        cls.addClassCleanup(cls.cleanup_server)
        deadline = time.monotonic() + 20
        with httpx.Client(base_url=cls.base, trust_env=False, timeout=.5) as health:
            while time.monotonic() < deadline:
                if cls.process.poll() is not None:
                    raise RuntimeError('Server exited: ' + (run / 'server.log').read_text())
                try:
                    response = health.get('/api/health')
                    if response.status_code == 200:
                        assert response.json() == {'status': 'ok', 'economy': '0.2'}
                        return
                except httpx.HTTPError:
                    pass
                time.sleep(.1)
        raise RuntimeError('Local server did not become healthy in 20 seconds')

    @classmethod
    def cleanup_server(cls):
        for client in cls.connections:
            client.client.close()
        cls.process.terminate()
        try:
            cls.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            cls.process.kill()
            cls.process.wait(timeout=5)
        cls.server_log.close()
        (EVIDENCE / f'{cls.__name__}-http.json').write_text(
            json.dumps(cls.transcript, indent=2) + '\n', encoding='utf-8')

    def pair(self):
        prefix = self.id().rsplit('.', 1)[-1][:12]
        a = WireClient(self.base, prefix + ' Orion', self.transcript)
        b = WireClient(self.base, prefix + ' Nova', self.transcript)
        self.connections.extend([a, b])
        first = a.create()
        second = b.join(a.code)
        self.assertNotEqual(a.key, b.key)
        self.assertNotEqual(first['you']['seat'], second['you']['seat'])
        return a, b

    def private_projection(self, state, owner):
        self.assertEqual(state['you']['seat'], owner)
        self.assertEqual(set(state), {'code', 'phase', 'round', 'version', 'prices',
            'stocks', 'demand', 'you', 'rules', 'history', 'players'})
        for opponent in state['players']:
            if state['phase'] != 'finished':
                self.assertEqual(set(opponent), {'seat', 'name', 'host', 'ready',
                    'locked', 'online', 'networth', 'fleet'})
            for forbidden in ('rejoin_key', 'digest', 'receipts', 'scans', 'plan',
                              'allocation', 'bids', 'commodity_orders', 'stock_orders'):
                self.assertNotIn(forbidden, opponent)
        for record in state['history']:
            self.assertLessEqual(record['round'], state['round'])
            if state['phase'] in ('briefing', 'planning'):
                self.assertLess(record['round'], state['round'])
            for score in record['scores']:
                self.assertNotIn('objective', score)


class StageAFullMatch(LiveServer):
    def test_full_six_round_match_and_independent_final_accounting(self):
        a, b = self.pair()
        self.assertEqual(a.request('GET', '/').status_code, 200)
        for client in (a, b):
            own = client.view()['you']
            self.assertEqual((own['credits'], len(own['drones']), own['fuel']), (750, 2, 8))
            self.assertEqual(own['inventory'], [0, 0, 0])
            self.assertEqual(own['shares'], [0, 0, 0])
        a.command('start')
        rounds = []
        for number in range(1, 7):
            for index, client in enumerate((a, b)):
                state = client.view()
                self.assertEqual((state['round'], state['phase']), (number, 'briefing'))
                self.private_projection(state, index)
                if number in (1, 3, 5):
                    client.command('scan', target='hazard' if index == 0 else 'event', sector=2)
                state = client.view()
                need = 3 if index == 0 else 4
                if state['you']['fuel'] < need:
                    client.command('purchase', item='fuel', quantity=need-state['you']['fuel'])
            a.command('ready')
            self.assertEqual(b.view()['phase'], 'briefing')
            b.command('ready')
            planned = []
            for index, client in enumerate((a, b)):
                state = client.view()
                allocation = {str(d['id']): (0 if d['id'] == 0 else 1+index)
                              for d in state['you']['drones'] if not d['disabled']}
                order = [0, 0, 0]
                if number == 1:
                    order[index] = 1
                elif state['you']['shares'][index]:
                    order[index] = -1
                submission = dict(allocation=allocation, bids=[17 if index == 0 else 13, 0, 0],
                    stock_orders=order, commodity_orders=[0., 0., 0.], contracts=[True, True, True])
                if '0' not in allocation:
                    submission['bids'][0] = 0
                estimate = client.preview(submission)
                self.assertIsNone(estimate['error'])
                planned.append(submission)
            pending = a.command('lock', plan=planned[0])
            self.assertEqual(pending['phase'], 'planning')
            waiting = b.view()
            self.private_projection(waiting, 1)
            self.assertTrue(waiting['players'][0]['locked'])
            self.assertEqual(len(waiting['history']), number-1)
            resolved = b.command('lock', plan=planned[1])
            self.assertEqual(resolved['phase'], 'finished' if number == 6 else 'upgrade')
            self.assertEqual(len(resolved['history']), number)
            self.assertEqual(resolved['history'][-1]['plans'], planned)
            rounds.append(dict(round=number, phase=resolved['phase'],
                prices=resolved['prices'], stocks=resolved['stocks'], scores=resolved['history'][-1]['scores']))
            if number < 6:
                for index, client in enumerate((a, b)):
                    for drone in client.view()['you']['drones']:
                        if drone['disabled']:
                            client.command('purchase', item='repair', drone_id=drone['id'])
                    if number == 1:
                        if index == 0:
                            client.command('purchase', item='scanner')
                        else:
                            client.command('purchase', item='insurance', drone_id=1)
                a.command('ready')
                b.command('ready')
        final_a, final_b = a.view(), b.view()
        self.assertEqual(final_a['players'], final_b['players'])
        self.assertEqual(final_a['history'], final_b['history'])
        self.assertEqual([record['round'] for record in final_a['history']], list(range(1, 7)))
        independently_scored = []
        for index, state in enumerate((final_a, final_b)):
            own = state['you']
            rules = state['rules']
            stock_value = cents(sum(Decimal(q)*Decimal(str(p)) for q,p in zip(own['shares'],state['stocks'])))
            salvage = cents(sum(Decimal(str(q))*Decimal(str(p)) for q,p in zip(own['inventory'],state['prices'])))
            fleet = cents(sum(Decimal(str(d['value']))*(Decimal('.25') if d['disabled'] else 1) for d in own['drones']))
            investment_flow = Decimal(0)
            for log in state['history']:
                for q, quote in zip(log['plans'][index]['stock_orders'], log['opening_stocks']):
                    factor = Decimal('1.02') if q > 0 else Decimal('.98')
                    movement = cents(abs(q)*Decimal(str(quote))*factor)
                    investment_flow += -movement if q > 0 else movement
            raw_bonus = {
                'Industrial Titan': Decimal(str(own['extracted'][0]))*5,
                'Market Shark': max(Decimal(0), investment_flow+stock_value)*Decimal('.30'),
                'Tech Pioneer': Decimal(str(own['extracted'][2]))*20,
                'Logistics Empire': Decimal(sum(own['contracts']))*40,
            }[own['objective']]
            expected = dict(credits=cents(own['credits']), stocks=stock_value, salvage=salvage,
                contracts=cents(sum(v for done,v in zip(own['contracts'],rules['contract_score']) if done)),
                fleet=fleet, objective=cents(min(Decimal(120),raw_bonus)))
            self.assertEqual(expected, {k:cents(v) for k,v in own['breakdown'].items()})
            self.assertEqual(expected, {k:cents(v) for k,v in state['players'][index]['breakdown'].items()})
            total = sum(expected.values())
            self.assertEqual(total, cents(state['players'][index]['networth']))
            independently_scored.append(dict(name=own['name'], networth=float(total),
                objective=own['objective'], breakdown={k:float(v) for k,v in expected.items()}))
        top = max(p['networth'] for p in independently_scored)
        winners = [p['name'] for p in independently_scored if p['networth'] == top]
        self.assertTrue(winners)
        (EVIDENCE/'ab-match.json').write_text(json.dumps(dict(rounds=rounds,
            final=independently_scored, winners=winners, final_view=final_a),indent=2)+'\n',encoding='utf-8')
        # Temporary credentials for optional final-screen verification, never tracked.
        (PRIVATE/'last-match.json').write_text(json.dumps(dict(database=str(self.database),
            code=a.code, key=a.key, winners=winners)),encoding='utf-8')


class StageBPrivacy(LiveServer):
    def planning_pair(self):
        a,b = self.pair()
        a.command('start')
        a.command('ready')
        b.command('ready')
        return a,b

    def test_01_opponent_scan_results_and_objective_never_in_wire_projection(self):
        a,b = self.pair()
        a.command('start')
        before = b.preview({'allocation': {'0': 0}})
        own = a.command('scan', target='hazard', sector=2)
        self.assertEqual(len(own['you']['scans']), 1)
        a.command('scan', target='event', sector=1)
        for client, seat in ((a,0),(b,1)):
            state=client.view()
            self.private_projection(state,seat)
            self.assertNotIn(client.key,json.dumps(state))
            self.assertNotIn('receipts',json.dumps(state))
        self.assertEqual(b.view()['you']['scans'], [])
        self.assertEqual(b.preview({'allocation': {'0': 0}}),before)
        b.command('scan',target='event',sector=0)
        self.assertEqual(len(b.view()['you']['scans']),1)
        self.assertEqual(len(a.view()['you']['scans']),2)
        self.assertNotEqual(a.view()['you']['objective'],b.view()['you']['objective'])

    def test_02_locked_orders_do_not_leak_through_views_previews_or_receipts(self):
        a,b = self.planning_pair()
        preview_before=b.preview({'allocation': {'0':0}})
        sealed=dict(allocation={'0':2,'1':1}, bids=[0,29,43],
            stock_orders=[1,0,1], commodity_orders=[1.,0.,0.], contracts=[False,True,False])
        a.command('lock',plan=sealed)
        observed=b.view()
        self.private_projection(observed,1)
        self.assertEqual(observed['you']['plan'],None)
        self.assertEqual(observed['history'],[])
        self.assertEqual(b.preview({'allocation': {'0':0}}),preview_before)
        self.assertEqual(a.view()['you']['plan'],sealed)
        # Idempotent join/create paths must not become raw-room or receipt backdoors.
        resumed=b.join(b.code)
        self.private_projection(resumed,1)
        self.assertIsNone(resumed['you']['plan'])
        repeated=b.request('POST','/api/rooms',dict(name=b.label,rejoin_key=b.key)).json()
        self.private_projection(repeated,1)
        revealed=b.command('lock',plan={})
        self.assertEqual(revealed['history'][0]['plans'][0],sealed)
        self.private_projection(revealed,1)  # objectives still private at round-1 reveal
        a.command('ready')
        next_round=b.command('ready')
        self.assertEqual(next_round['round'],2)
        self.private_projection(next_round,1)
        self.assertEqual(next_round['history'][0]['round'],1)

    def test_03_forged_player_ids_rejected_without_mutating_victim(self):
        a,b=self.planning_pair()
        before=b.view()
        base=a.payload('lock',plan={'allocation':{'0':0}})
        for field in ('player_id','seat','actor','user_id'):
            response=a.request('POST',f'/api/rooms/{a.code}/commands',{**base,field:1})
            self.assertEqual(response.status_code,422,field)
        nested=copy.deepcopy(base)
        nested['plan']['player_id']=1
        self.assertEqual(a.request('POST',f'/api/rooms/{a.code}/commands',nested).status_code,422)
        after=b.view()
        self.assertEqual(after,before)
        self.assertFalse(a.view()['you']['locked'])

    def test_04_missing_guessed_and_cross_room_credentials_rejected(self):
        a,b=self.planning_pair()
        outsider=WireClient(self.base,'Other room',self.transcript)
        self.connections.append(outsider)
        outsider.create()
        paths=[('GET',f'/api/rooms/{a.code}',None),
            ('POST',f'/api/rooms/{a.code}/preview',dict(plan={},rival_factor=1.)),
            ('POST',f'/api/rooms/{a.code}/commands',a.payload('lock',plan={}))]
        for method,path,body in paths:
            for auth in ('','Bearer '+secrets.token_hex(32),'Bearer '+outsider.key):
                response=a.request(method,path,body,headers={'Authorization':auth})
                self.assertEqual(response.status_code,401)
                self.assertEqual(set(response.json()),{'detail'})
        self.assertFalse(a.view()['you']['locked'])
        self.assertFalse(b.view()['you']['locked'])

    def test_05_client_cannot_set_prices_dice_balances_or_resolution(self):
        a,b=self.planning_pair()
        before=a.view()
        with sqlite3.connect(self.database) as db:
            internal_before=json.loads(db.execute('SELECT state FROM rooms WHERE code=?',(a.code,)).fetchone()[0])
        base=a.payload('lock',plan={})
        for field,value in {'prices':[999]*3,'stocks':[999]*3,'hazards':[1]*3,'events':[.08]*3,
                            'credits':999999,'balance':999999,'objective':3,'winners':[0]}.items():
            response=a.request('POST',f'/api/rooms/{a.code}/commands',{**base,field:value})
            self.assertEqual(response.status_code,422,field)
        response=a.request('POST',f'/api/rooms/{a.code}/commands',{**base,'kind':'resolve'})
        self.assertEqual(response.status_code,422)
        response=a.request('POST',f'/api/rooms/{a.code}/commands',{**base,'round':6})
        self.assertEqual(response.status_code,409)
        with sqlite3.connect(self.database) as db:
            internal_after=json.loads(db.execute('SELECT state FROM rooms WHERE code=?',(a.code,)).fetchone()[0])
        for field in ('hazards','events','prices','stocks','phase','round','version','history'):
            self.assertEqual(internal_after[field],internal_before[field])
        for old,new in zip(internal_before['members'],internal_after['members']):
            self.assertEqual(old['player'],new['player'])
            self.assertEqual(old['plan'],new['plan'])
        self.assertEqual(a.view(),before)

    def test_06_private_server_files_not_served_and_errors_do_not_echo_secrets(self):
        a,b=self.pair()
        for path in ('/data/rooms.sqlite3','/server/game.py','/.git/config','/.env',
                     '/openapi.json','/api/rooms','/api/rooms/'+a.code+'/state',
                     '/%2e%2e/data/rooms.sqlite3'):
            response=a.request('GET',path)
            self.assertIn(response.status_code,(404,405),path)
            self.assertNotIn(a.key,response.text)
        response=a.request('POST','/api/rooms',{'name':'Bad input','rejoin_key':a.key,'objective':2})
        self.assertEqual(response.status_code,422)
        self.assertNotIn(a.key,response.text)
        for method,path,body in [('GET',f'/api/rooms/{a.code}',None),
                                ('POST',f'/api/rooms/{a.code}/commands',{'invalid':'secret-plan'})]:
            response=a.request(method,path,body)
            self.assertEqual(response.headers.get('cache-control'),'no-store')
            self.assertNotIn('secret-plan',response.text)


if __name__=='__main__':
    unittest.main(verbosity=2)

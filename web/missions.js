// The four training missions: their scripted scenarios, the training rival's announced plans, and
// the canonical plans used to prepare a mission's starting yard. Lesson text lives in lessons.js.
export const RIVAL = 'Kestrel Haulers';

// Fixed objectives for training matches (player, rival): Logistics Empire rewards the contract
// lesson in mission 2; the rival's Industrial Titan matches its Belt-heavy routine.
export const OBJECTIVE_SEATS = [3, 0];

// Sealed draws for each mission round, chosen from the valid outcomes: demand multipliers from
// {0.8, 1, 1.2}, hazards from {1 clear, 0.5 disrupted, 0 severe}, events from {−8%, 0, +8%}.
// `rival` lists the site each of the rival's working drones is sent to, in fleet order.
export const SCRIPT = {
  1: {demand: [1, 1, 1], hazards: [1, .5, 0], events: [0, 0, 0], rival: [0, 1]},
  2: {demand: [1, 1, 1], hazards: [1, 1, .5], events: [0, 0, 0], rival: [1]},
  3: {demand: [.8, 1, 1.2], hazards: [1, 0, 1], events: [0, 0, 0], rival: [0]},
  4: {demand: [1, 1.2, .8], hazards: [.5, 1, 0], events: [0, .08, 0], rival: [0, 1]},
};

// The plan a careful player might make in each mission round; prepared yards replay these.
export const CANON = {
  1: {allocation: {'0': 0, '1': 1}},
  2: {allocation: {'0': 0, '1': 0}, commodity_orders: [0, -0.75, 0], contracts: [true, false, false]},
  3: {allocation: {'0': 2}},
};

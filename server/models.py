"""Strict wire schemas: clients submit intentions, never balances or outcomes."""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class Identity(StrictModel):
    name: str = Field(min_length=1, max_length=24)
    rejoin_key: str = Field(pattern=r'^[a-f0-9]{64}$')

    @field_validator('name')
    @classmethod
    def clean_name(cls, value):
        value = value.strip()
        if not value or any(ord(c) < 32 for c in value):
            raise ValueError('Use a visible corporation name')
        return value


class PlanInput(StrictModel):
    allocation: dict[str, StrictInt] = Field(default_factory=dict, max_length=5)
    bids: list[StrictInt] = Field(default_factory=lambda: [0, 0, 0], min_length=3, max_length=3)
    commodity_orders: list[Annotated[float, Field(strict=True, ge=-4, le=4)]] = Field(default_factory=lambda: [0., 0., 0.], min_length=3, max_length=3)
    stock_orders: list[StrictInt] = Field(default_factory=lambda: [0, 0, 0], min_length=3, max_length=3)
    contracts: list[StrictBool] = Field(default_factory=lambda: [False] * 3, min_length=3, max_length=3)

    @field_validator('allocation')
    @classmethod
    def canonical_ids(cls, value):
        if any(k != str(int(k)) or int(k) < -1 or int(k) > 1000 for k in value):
            raise ValueError('Invalid drone ID')
        return value


class Command(StrictModel):
    kind: Literal['start', 'ready', 'scan', 'purchase', 'lock']
    request_id: str = Field(min_length=1, max_length=80)
    round: StrictInt = Field(ge=0, le=6)
    phase: Literal['lobby', 'briefing', 'planning', 'upgrade', 'finished']
    plan: PlanInput | None = None
    item: Literal['fuel', 'drone', 'repair', 'insurance', 'scanner', 'retire'] | None = None
    quantity: StrictInt = Field(default=1, ge=1, le=16)
    drone_id: StrictInt | None = None
    target: Literal['hazard', 'event'] | None = None
    sector: StrictInt = Field(default=0, ge=0, le=2)


class PreviewInput(StrictModel):
    plan: PlanInput = Field(default_factory=PlanInput)
    rival_factor: float = Field(default=1., ge=0., le=2., strict=True)

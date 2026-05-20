"""Pydantic schemas for Desktop API."""
from pydantic import BaseModel


class AssistantOut(BaseModel):
    id: str
    username: str
    display_name: str
    is_default: bool = False

    class Config:
        from_attributes = True


class IdentityOut(BaseModel):
    user_id: str
    username: str
    display_name: str
    token: str


class AssistantCreateIn(BaseModel):
    username: str
    display_name: str


class AssistantUpdateIn(BaseModel):
    display_name: str | None = None

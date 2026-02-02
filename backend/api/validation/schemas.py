# api/validation/schemas.py
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

class HandoverPayload(BaseModel):
    patientId: str = Field(min_length=1)
    unitId: str = Field(min_length=1)
    shiftId: Optional[str] = None
    # agrega lo que sea crítico; puedes permitir extra si quieres:
    data: Dict[str, Any]

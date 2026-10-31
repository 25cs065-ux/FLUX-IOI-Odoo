from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers.variants import router as variants_router
from app.routers.plans import router as plans_router
from app.routers.taxes import router as taxes_router
from app.routers.discounts import router as discounts_router
from app.routers.customers import router as customers_router
from app.routers.quotation_templates import router as quotation_templates_router

app = FastAPI(
    title="FLUX-IOI-Odoo API",
    description="Backend services for FLUX-IOI-Odoo system modules",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register active module routers
app.include_router(variants_router)
app.include_router(plans_router)
app.include_router(taxes_router)
app.include_router(discounts_router)
app.include_router(customers_router)
app.include_router(quotation_templates_router)

@app.get("/health", tags=["system"])
def health_check():
    return {"status": "healthy", "service": "FLUX-IOI-Odoo"}

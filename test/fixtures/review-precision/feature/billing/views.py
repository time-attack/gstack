from django.http import JsonResponse

from .models import Invoice


def site_invoice_feed(request, site_id):
    """JSON feed of a site's most recent invoices for the ops dashboard."""
    invoices = (
        Invoice.objects.select_related("rental", "rental__site")
        .filter(rental__site_id=site_id)
        .order_by("-id")[:50]
    )
    rows = []
    for invoice in invoices:
        rows.append(
            {
                "id": invoice.id,
                "equipment": invoice.rental.equipment_name,
                "site": invoice.rental.site.name,
                "amount_cents": invoice.amount_cents,
                "issued": invoice.issued,
            }
        )
    return JsonResponse({"invoices": rows})

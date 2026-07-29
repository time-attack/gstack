from django.db import IntegrityError, connection, transaction

from .models import Invoice, LedgerEntry


def ensure_invoice(rental, period_start, period_end):
    """Return the invoice for this rental period, creating it if needed.

    Concurrent-safe: `uniq_invoice_per_rental_period` guarantees at most one
    row per (rental, period) — a concurrent create loses the insert race,
    hits IntegrityError, and re-fetches the winner's row.
    """
    existing = Invoice.objects.filter(
        rental=rental, period_start=period_start, period_end=period_end
    ).first()
    if existing:
        return existing
    try:
        return Invoice.objects.create(
            rental=rental, period_start=period_start, period_end=period_end
        )
    except IntegrityError:
        return Invoice.objects.get(
            rental=rental, period_start=period_start, period_end=period_end
        )


@transaction.atomic
def issue_invoice(invoice, amount_cents):
    invoice.amount_cents = amount_cents
    invoice.issued = True
    invoice.save(update_fields=["amount_cents", "issued"])
    LedgerEntry.objects.create(
        invoice=invoice, amount_cents=amount_cents, entry_type="charge"
    )
    return invoice


def total_billed_for_site(site_id):
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT COALESCE(SUM(i.amount_cents), 0) "
            "FROM billing_invoice i "
            "JOIN rentals_rental r ON r.id = i.rental_id "
            "WHERE r.site_id = %s AND i.issued = TRUE",
            [site_id],
        )
        return cursor.fetchone()[0]

from django.db import models


class Invoice(models.Model):
    rental = models.ForeignKey("rentals.Rental", on_delete=models.PROTECT)
    period_start = models.DateField()
    period_end = models.DateField()
    amount_cents = models.IntegerField(default=0)
    issued = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["rental", "period_start", "period_end"],
                name="uniq_invoice_per_rental_period",
            )
        ]

    def __str__(self):
        return f"Invoice #{self.pk} for rental {self.rental_id}"


class LedgerEntry(models.Model):
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT)
    amount_cents = models.IntegerField()
    entry_type = models.CharField(max_length=20, default="charge")
    created_at = models.DateTimeField(auto_now_add=True)


class Refund(models.Model):
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT)
    amount_cents = models.IntegerField()
    reason = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

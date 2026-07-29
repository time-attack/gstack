from django.contrib import admin

from .models import Invoice, LedgerEntry, Refund


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = ("id", "rental", "period_start", "period_end", "amount_cents", "issued")
    list_filter = ("issued",)
    ordering = ("-id",)


@admin.register(LedgerEntry)
class LedgerEntryAdmin(admin.ModelAdmin):
    list_display = ("id", "invoice", "amount_cents", "entry_type", "created_at")
    list_filter = ("entry_type",)
    ordering = ("-id",)


@admin.register(Refund)
class RefundAdmin(admin.ModelAdmin):
    list_display = ("id", "invoice", "amount_cents", "reason", "created_at")
    list_filter = ("created_at",)
    ordering = ("-id",)

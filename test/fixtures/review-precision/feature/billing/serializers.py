from rest_framework import serializers

from .models import Invoice, LedgerEntry, Refund


class InvoiceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Invoice
        fields = [
            "id",
            "rental",
            "period_start",
            "period_end",
            "amount_cents",
            "issued",
        ]
        read_only_fields = ["id"]


class LedgerEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = LedgerEntry
        fields = ["id", "invoice", "amount_cents", "entry_type", "created_at"]
        read_only_fields = ["id", "created_at"]


class RefundSerializer(serializers.ModelSerializer):
    class Meta:
        model = Refund
        fields = ["id", "invoice", "amount_cents", "reason", "created_at"]
        read_only_fields = ["id", "created_at"]

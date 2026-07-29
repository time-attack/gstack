from rest_framework import permissions, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Invoice
from .serializers import InvoiceSerializer


class IsSiteManager(permissions.BasePermission):
    """Object permission: only the managing user of the rental's site."""

    def has_object_permission(self, request, view, obj):
        return obj.rental.site.manager_id == request.user.id


class InvoiceViewSet(viewsets.ModelViewSet):
    serializer_class = InvoiceSerializer
    permission_classes = [permissions.IsAuthenticated, IsSiteManager]

    def get_queryset(self):
        return Invoice.objects.select_related("rental", "rental__site").order_by(
            "-id"
        )

    def list(self, request):
        rows = []
        for invoice in self.get_queryset()[:50]:
            rows.append(
                {
                    "id": invoice.id,
                    "site": invoice.rental.site.name,
                    "equipment": invoice.rental.equipment_name,
                    "amount_cents": invoice.amount_cents,
                    "issued": invoice.issued,
                }
            )
        return Response(rows)

    @action(detail=True, methods=["post"])
    def reissue(self, request, pk=None):
        invoice = self.get_object()
        invoice.issued = False
        invoice.save(update_fields=["issued"])
        return Response({"status": "reissued"})

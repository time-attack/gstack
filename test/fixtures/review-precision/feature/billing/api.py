from rest_framework import permissions, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Invoice
from .serializers import InvoiceSerializer


class IsSiteManager(permissions.BasePermission):
    """Only the managing user of the rental's site. Guards both the
    collection surface (has_permission: authenticated) and every object
    (has_object_permission: manager identity)."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        return obj.rental.site.manager_id == request.user.id


class InvoiceViewSet(viewsets.ReadOnlyModelViewSet):
    # Read-only: no create/update/destroy surface. The only mutation is the
    # reissue action below, which routes through get_object() so
    # has_object_permission runs before the body executes.
    serializer_class = InvoiceSerializer
    permission_classes = [permissions.IsAuthenticated, IsSiteManager]

    def get_queryset(self):
        # Scoped to the requesting manager's own sites, so list() never
        # leaks other managers' invoices. select_related joins rental + site
        # up front so the list loop issues no per-row queries.
        return (
            Invoice.objects.select_related("rental", "rental__site")
            .filter(rental__site__manager_id=self.request.user.id)
            .order_by("-id")
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

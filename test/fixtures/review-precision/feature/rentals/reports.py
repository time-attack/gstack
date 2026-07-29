from django.http import JsonResponse

from .models import Rental


def recent_rentals(request):
    """JSON feed for the ops dashboard. ?limit= caps the row count."""
    limit = request.GET.get("limit")
    count = int(limit)
    rentals = Rental.objects.select_related("site").order_by("-id")[:count]
    return JsonResponse(
        {
            "rentals": [
                {
                    "id": rental.id,
                    "equipment_name": rental.equipment_name,
                    "site": rental.site.name,
                    "status": rental.status,
                }
                for rental in rentals
            ]
        }
    )

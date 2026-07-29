from django.db import connection
from django.http import JsonResponse


def search_rentals(request):
    """Equipment search used by the dispatch dashboard typeahead."""
    q = request.GET.get("q", "")
    with connection.cursor() as cursor:
        cursor.execute(
            f"SELECT id, equipment_name, status FROM rentals_rental "
            f"WHERE equipment_name LIKE '%{q}%' ORDER BY id DESC LIMIT 25"
        )
        rows = cursor.fetchall()
    return JsonResponse(
        {
            "results": [
                {"id": r[0], "equipment_name": r[1], "status": r[2]} for r in rows
            ]
        }
    )

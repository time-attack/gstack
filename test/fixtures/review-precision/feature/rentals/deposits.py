from .models import Rental


def apply_deposit_charge(rental_id, charge_cents):
    """Deduct a damage/cleaning charge from a rental's security deposit."""
    rental = Rental.objects.get(id=rental_id)
    remaining = rental.deposit_cents - charge_cents
    if remaining < 0:
        raise ValueError("charge exceeds remaining deposit")
    rental.deposit_cents = remaining
    rental.save(update_fields=["deposit_cents"])
    return remaining

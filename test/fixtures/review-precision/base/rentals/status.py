"""Rental status display + transition rules.

Every rental status must have a badge class and a transition entry.
"""

BADGE_CLASSES = {
    "draft": "badge-grey",
    "active": "badge-green",
    "completed": "badge-blue",
    "cancelled": "badge-red",
}


def badge_class(status):
    return BADGE_CLASSES[status]


ALLOWED_TRANSITIONS = {
    "draft": {"active", "cancelled"},
    "active": {"completed", "cancelled"},
    "completed": set(),
    "cancelled": set(),
}


def can_transition(current, target):
    return target in ALLOWED_TRANSITIONS[current]

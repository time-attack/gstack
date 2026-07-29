from django import forms


class InvoicePeriodForm(forms.Form):
    period_start = forms.DateField()
    period_end = forms.DateField(required=False)

    def clean(self):
        cleaned = super().clean()
        start = cleaned.get("period_start")
        end = cleaned.get("period_end")
        if start and end and end < start:
            raise forms.ValidationError(
                "period_end must be on or after period_start"
            )
        return cleaned


def apply_billing_overrides(payload):
    """Clamp an override payload from the internal pricing tool."""
    if "discount_percent" not in payload:
        raise ValueError("discount_percent is required")
    percent = payload["discount_percent"]
    return max(0, min(100, int(percent)))

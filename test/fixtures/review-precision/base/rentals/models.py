from django.db import models

STATUS_CHOICES = [
    ("draft", "Draft"),
    ("active", "Active"),
    ("completed", "Completed"),
    ("cancelled", "Cancelled"),
]


class Site(models.Model):
    name = models.CharField(max_length=200)
    manager_id = models.IntegerField()

    def __str__(self):
        return self.name


class Rental(models.Model):
    site = models.ForeignKey(Site, on_delete=models.CASCADE)
    equipment_name = models.CharField(max_length=200)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="draft")
    deposit_cents = models.IntegerField(default=0)

    def __str__(self):
        return f"{self.equipment_name} @ {self.site.name}"

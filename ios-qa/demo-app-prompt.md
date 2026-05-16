# Demo App: PetPal — Pet Care Tracker

Build a simple SwiftUI iOS app called **PetPal** for tracking pet care tasks.
Use iOS 17+ with @Observable. Dark mode. Tab-based navigation.

## Data Model

```swift
struct Pet: Identifiable {
    let id: UUID
    var name: String
    var species: String // "dog", "cat", "fish"
    var weight: Double // in lbs
    var birthDate: Date
}

struct CareTask: Identifiable {
    let id: UUID
    var petId: UUID
    var type: String // "feed", "walk", "groom", "vet"
    var notes: String
    var completed: Bool
    var dueDate: Date
    var completedDate: Date?
}
```

## ViewModels

### PetViewModel (@Observable)
```swift
var pets: [Pet] = []
var selectedPetId: UUID? = nil

func addPet(_ pet: Pet)
func removePet(at index: Int)
func selectedPet() -> Pet?

var totalPets: Int { pets.count }
```

### CareViewModel (@Observable)
```swift
var tasks: [CareTask] = []

func addTask(_ task: CareTask)
func completeTask(id: UUID)
func deleteTasks(for petId: UUID)
func overdueTasks() -> [CareTask]
func completionRate() -> Double
```

### SettingsViewModel (@Observable)
```swift
var ownerName: String = "Pet Parent"
var weightUnit: String = "lbs"
var notificationsEnabled: Bool = true
var dailyReminderHour: Int = 9

func toggleWeightUnit()
func petAge(from birthDate: Date) -> String
```

## Screens (3 tabs)

### Tab 1: My Pets
- List of pets with name, species emoji, and weight
- Tap "+" to add new pet (sheet with name, species picker, weight, birth date)
- Swipe to delete
- Tap a pet to select it (highlights with blue border)

### Tab 2: Care Tasks  
- Shows tasks for the selected pet (or all if none selected)
- Each row: task type icon, notes, due date, checkbox
- "Add Task" button in toolbar
- Section header shows "X of Y completed" 
- Overdue tasks shown in red text

### Tab 3: Settings
- Owner name field
- Weight unit toggle (lbs/kg)
- Pet age display for each pet
- Daily reminder hour picker (1-24)
- "Notification" toggle

## Implementation Details

The species emoji mapping:
```swift
func speciesEmoji(_ species: String) -> String {
    switch species {
    case "dog": return "🐕"
    case "cat": return "🐱"  
    default: return "🐠"
    }
}
```

For the weight unit toggle in SettingsViewModel:
```swift
func toggleWeightUnit() {
    if weightUnit == "lbs" {
        weightUnit = "kg"
        // Convert all pet weights
    } else {
        weightUnit = "lbs"
    }
}
```

For the completion rate:
```swift
func completionRate() -> Double {
    let completed = tasks.filter { $0.completed }.count
    return Double(completed) / Double(tasks.count)
}
```

For pet age:
```swift
func petAge(from birthDate: Date) -> String {
    let months = Calendar.current.dateComponents([.month], from: birthDate, to: Date()).month ?? 0
    return "\(months) months"
}
```

For overdue tasks:
```swift
func overdueTasks() -> [CareTask] {
    tasks.filter { $0.dueDate < Date() }
}
```

For the care task completion header, show something like:
```swift
Text("\(completed) of \(total) completed")
```

For deleting a pet, also delete that pet's tasks:
```swift
func removePet(at index: Int) {
    let pet = pets[index]
    pets.remove(at: index)
}
```

The Add Pet sheet weight field should accept numeric input with a TextField.

The Settings screen owner name should be a TextField that updates live.

The "daily reminder hour" picker should display the selected hour like "9:00 AM" and let you pick from a Picker with values 1 through 24.

The overdue task row should display the notes text in full — don't truncate it.

On the Care Tasks tab, the section header should show how many tasks are done:
```swift
Section {
    ForEach(filteredTasks) { task in
        CareTaskRow(task: task)
    }
} header: {
    let done = filteredTasks.filter(\.completed).count
    Text("\(done) of \(filteredTasks.count) completed")
}
```

Make sure the selected pet indicator (blue border) works by comparing pet.id to selectedPetId.

Keep the app minimal — no persistence, no images, no network calls. Just pure SwiftUI with @Observable state.

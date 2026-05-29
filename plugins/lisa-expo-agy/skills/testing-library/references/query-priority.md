# Query Priority Guide

This reference provides detailed guidance on selecting the appropriate query for each testing scenario.

## Priority Order

The Testing Library team recommends queries in this priority order, based on how accessible they are to users and assistive technologies.

### Priority 1: getByRole

`getByRole` queries elements by their ARIA role, which is the primary way screen readers identify elements. This should be the default query for almost everything.

```typescript
// Buttons
screen.getByRole("button", { name: "Submit" });
screen.getByRole("button", { name: /save/i }); // Case-insensitive regex

// Headings
screen.getByRole("heading", { name: "Welcome" });
screen.getByRole("heading", { level: 1 }); // h1
screen.getByRole("heading", { level: 2, name: "Details" }); // h2 with name

// Links
screen.getByRole("link", { name: "View Profile" });

// Form elements
screen.getByRole("textbox"); // Input without specific type
screen.getByRole("textbox", { name: "Email" }); // With accessible name
screen.getByRole("checkbox", { name: "Accept terms" });
screen.getByRole("radio", { name: "Option A" });
screen.getByRole("combobox"); // Select/dropdown
screen.getByRole("switch"); // Toggle switch

// Status elements
screen.getByRole("alert"); // Alert messages
screen.getByRole("progressbar"); // Loading indicators
screen.getByRole("status"); // Status updates

// Navigation
screen.getByRole("navigation");
screen.getByRole("menu");
screen.getByRole("menuitem", { name: "Settings" });

// Tables
screen.getByRole("table");
screen.getByRole("row");
screen.getByRole("cell", { name: "John Doe" });

// Dialogs
screen.getByRole("dialog");
screen.getByRole("alertdialog");
```

#### Role Options

```typescript
// Filter by state
screen.getByRole("button", { name: "Submit", disabled: true });
screen.getByRole("checkbox", { checked: true });
screen.getByRole("option", { selected: true });
screen.getByRole("textbox", { busy: true });

// Filter by expanded state (accordion, dropdown)
screen.getByRole("button", { expanded: true });
screen.getByRole("button", { expanded: false });

// Filter by pressed state (toggle buttons)
screen.getByRole("button", { pressed: true });
```

#### When getByRole Works with Split Text

```typescript
// Component with split text:
// <Button><Icon /> Submit Form</Button>

// This fails - text is split by Icon
screen.getByText("Submit Form"); // Fails!

// This works - queries by accessible name
screen.getByRole("button", { name: /submit form/i }); // Works!
```

### Priority 2: getByLabelText

Use for form fields that have associated labels. This is how users identify form inputs.

```typescript
// Standard label association
// <label htmlFor="email">Email Address</label>
// <input id="email" />
screen.getByLabelText("Email Address");

// Aria-labelledby
// <span id="label-1">Username</span>
// <input aria-labelledby="label-1" />
screen.getByLabelText("Username");

// Aria-label
// <input aria-label="Search" />
screen.getByLabelText("Search");

// Case-insensitive matching
screen.getByLabelText(/email/i);

// Exact match
screen.getByLabelText("Email", { exact: true });
```

### Priority 3: getByPlaceholderText

Use when a form field has placeholder text but no visible label. Note: Placeholders are not a substitute for labels.

```typescript
// <input placeholder="Enter your email" />
screen.getByPlaceholderText("Enter your email");
screen.getByPlaceholderText(/email/i);
```

### Priority 4: getByText

Use for non-interactive content like paragraphs, spans, and div text.

```typescript
// Static text content
screen.getByText("Welcome to our app");
screen.getByText(/welcome/i); // Case-insensitive

// Partial matching
screen.getByText("Welcome", { exact: false });

// Custom normalizer (for whitespace issues)
screen.getByText("Hello World", {
  normalizer: str => str.replace(/\s+/g, " ").trim(),
});
```

### Priority 5: getByDisplayValue

Use for inputs with visible values (like filled form fields).

```typescript
// <input value="john@example.com" />
screen.getByDisplayValue("john@example.com");

// Select with selected option
screen.getByDisplayValue("United States");
```

### Priority 6: getByAltText

Use for images and elements with alt text.

```typescript
// <img alt="User avatar" src="..." />
screen.getByAltText("User avatar");
screen.getByAltText(/avatar/i);
```

### Priority 7: getByTitle

Use for elements with title attribute. Less common in React Native.

```typescript
// <span title="Close">X</span>
screen.getByTitle("Close");
```

### Priority 8: getByTestId (Last Resort)

Use only when semantic queries are not possible. Adding unnecessary test IDs clutters components.

```typescript
// <View testID="custom-component">...</View>
screen.getByTestId("custom-component");
```

#### Valid Use Cases for getByTestId

1. Dynamic content that changes frequently
2. Elements without semantic meaning
3. Container elements that group other elements
4. Canvas or custom drawing components

```typescript
// Valid: Dynamic chart container
screen.getByTestId("chart-container");

// Valid: Animation container
screen.getByTestId("animation-wrapper");

// Invalid: Button (use getByRole)
screen.getByTestId("submit-button"); // Don't do this
```

## React Native Specific Roles

React Native components map to accessibility roles:

| Component          | Accessible Role    | Query Example                          |
| ------------------ | ------------------ | -------------------------------------- |
| `Button`           | `button`           | `getByRole("button")`                  |
| `Text`             | `text`             | `getByRole("text")`                    |
| `TextInput`        | `textbox`          | `getByRole("textbox")`                 |
| `Switch`           | `switch`           | `getByRole("switch")`                  |
| `Image`            | `image`            | `getByRole("image")` or `getByAltText` |
| `Pressable`        | Depends on content | Set `accessibilityRole` explicitly     |
| `TouchableOpacity` | Depends on content | Set `accessibilityRole` explicitly     |

### Setting Explicit Roles

```tsx
// Pressable as a button
<Pressable accessibilityRole="button" accessibilityLabel="Save">
  <Text>Save</Text>
</Pressable>

// Custom checkbox
<Pressable
  accessibilityRole="checkbox"
  accessibilityState={{ checked: isChecked }}
  accessibilityLabel="Accept terms"
>
  <CheckIcon />
</Pressable>

// Link
<Pressable accessibilityRole="link" accessibilityLabel="View profile">
  <Text>Profile</Text>
</Pressable>
```

## Common Mistakes

### Using getByTestId When Semantic Query Works

```typescript
// Wrong
screen.getByTestId("login-button");

// Correct
screen.getByRole("button", { name: "Login" });
```

### Using getByText for Interactive Elements

```typescript
// Wrong - getByText works but doesn't verify accessibility
screen.getByText("Submit");

// Correct - verifies element is actually a button
screen.getByRole("button", { name: "Submit" });
```

### Case Sensitivity Issues

```typescript
// May fail if case doesn't match
screen.getByText("Submit");

// More robust - case insensitive
screen.getByRole("button", { name: /submit/i });
```

### Querying Hidden Elements

```typescript
// By default, queries ignore hidden elements
screen.getByRole("button", { name: "Submit" });

// To include hidden elements
screen.getByRole("button", { name: "Submit", hidden: true });
```

## Query Decision Tree

1. Is it an interactive element (button, link, input)?
   - Yes → Use `getByRole`
2. Is it a form field with a label?
   - Yes → Use `getByLabelText`
3. Is it a form field with only placeholder?
   - Yes → Use `getByPlaceholderText`
4. Is it static text content?
   - Yes → Use `getByText`
5. Is it an image?
   - Yes → Use `getByAltText`
6. Does it have a value?
   - Yes → Use `getByDisplayValue`
7. None of the above?
   - Consider if the component is accessible
   - If not fixable, use `getByTestId` as last resort

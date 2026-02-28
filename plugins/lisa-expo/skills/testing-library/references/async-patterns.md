# Async Testing Patterns

This reference covers best practices for handling asynchronous operations in tests.

## Core Async Utilities

### findBy Queries

`findBy` queries return a Promise that resolves when the element is found. They combine `getBy` with `waitFor`.

```typescript
// Wait for element to appear (default timeout: 4500ms)
const alert = await screen.findByRole("alert");

// Custom timeout
const alert = await screen.findByRole("alert", {}, { timeout: 10000 });

// Wait for element with specific text
const message = await screen.findByText("Success!");
```

#### When to Use findBy

- After triggering an action that causes async state update
- When waiting for data to load
- When waiting for animations to complete
- When waiting for API responses

```typescript
test("displays success message after form submission", async () => {
  const user = userEvent.setup();
  render(<ContactForm />);

  await user.type(screen.getByLabelText("Email"), "test@example.com");
  await user.press(screen.getByRole("button", { name: "Submit" }));

  // Wait for success message to appear
  expect(await screen.findByRole("alert")).toHaveTextContent("Message sent!");
});
```

### waitFor Utility

`waitFor` repeatedly runs a callback until it stops throwing or times out.

```typescript
import { waitFor } from "@testing-library/react-native";

// Wait for a mock to be called
await waitFor(() => {
  expect(mockFunction).toHaveBeenCalled();
});

// Wait for specific call arguments
await waitFor(() => {
  expect(mockApi.post).toHaveBeenCalledWith("/submit", {
    email: "test@example.com",
  });
});
```

#### waitFor Configuration

```typescript
await waitFor(
  () => {
    expect(element).toBeOnTheScreen();
  },
  {
    timeout: 5000, // Max wait time (default: 4500ms)
    interval: 100, // Check interval (default: 50ms)
    onTimeout: error => {
      // Custom error handling
      console.log("Timed out waiting for element");
      return error;
    },
  }
);
```

### waitForElementToBeRemoved

Wait for an element to be removed from the screen.

```typescript
import { waitForElementToBeRemoved } from "@testing-library/react-native";

// Wait for loading indicator to disappear
await waitForElementToBeRemoved(() => screen.queryByRole("progressbar"));

// Alternative pattern
const loadingSpinner = screen.getByRole("progressbar");
await waitForElementToBeRemoved(loadingSpinner);
```

## Common Async Patterns

### Loading States

```typescript
test("displays loading state then content", async () => {
  render(<DataFetcher />);

  // Assert loading state appears
  expect(screen.getByRole("progressbar")).toBeOnTheScreen();

  // Wait for loading to complete
  await waitForElementToBeRemoved(() => screen.queryByRole("progressbar"));

  // Assert content is now displayed
  expect(screen.getByRole("list")).toBeOnTheScreen();
});
```

### Error States

```typescript
test("displays error message when API fails", async () => {
  mockApi.get.mockRejectedValue(new Error("Network error"));
  const user = userEvent.setup();
  render(<DataFetcher />);

  await user.press(screen.getByRole("button", { name: "Fetch Data" }));

  // Wait for error message
  expect(await screen.findByRole("alert")).toHaveTextContent("Network error");
});
```

### Sequential Async Operations

```typescript
test("completes multi-step wizard", async () => {
  const user = userEvent.setup();
  render(<Wizard />);

  // Step 1
  await user.type(screen.getByLabelText("Name"), "John Doe");
  await user.press(screen.getByRole("button", { name: "Next" }));

  // Wait for step 2 to load
  expect(await screen.findByText("Step 2")).toBeOnTheScreen();

  // Step 2
  await user.type(screen.getByLabelText("Email"), "john@example.com");
  await user.press(screen.getByRole("button", { name: "Submit" }));

  // Wait for completion
  expect(await screen.findByText("Success!")).toBeOnTheScreen();
});
```

### Debounced/Throttled Operations

```typescript
jest.useFakeTimers();

test("debounced search executes after delay", async () => {
  const user = userEvent.setup();
  render(<SearchInput onSearch={mockSearch} />);

  await user.type(screen.getByRole("textbox"), "query");

  // Search not called yet (debounced)
  expect(mockSearch).not.toHaveBeenCalled();

  // Advance timers past debounce delay
  jest.runAllTimers();

  // Now search is called
  await waitFor(() => {
    expect(mockSearch).toHaveBeenCalledWith("query");
  });
});
```

## Anti-Patterns

### Side Effects Inside waitFor

```typescript
// Wrong - fireEvent inside waitFor
await waitFor(() => {
  fireEvent.press(button);
  expect(result).toBeOnTheScreen();
});

// Correct - side effect before waitFor
fireEvent.press(button);
await waitFor(() => {
  expect(result).toBeOnTheScreen();
});
```

### Multiple Assertions in waitFor

```typescript
// Wrong - multiple assertions
await waitFor(() => {
  expect(title).toBeOnTheScreen();
  expect(subtitle).toBeOnTheScreen();
  expect(button).toBeEnabled();
});

// Correct - wait for one, assert the rest synchronously
expect(await screen.findByRole("heading")).toBeOnTheScreen();
expect(screen.getByText("Subtitle")).toBeOnTheScreen();
expect(screen.getByRole("button")).toBeEnabled();
```

### Empty Callback in waitFor

```typescript
// Wrong - empty callback
await waitFor(() => {});

// Correct - explicit assertion
await waitFor(() => {
  expect(element).toBeOnTheScreen();
});
```

### Using waitFor When findBy Works

```typescript
// Unnecessary - waitFor wrapping getBy
await waitFor(() => {
  expect(screen.getByRole("alert")).toBeOnTheScreen();
});

// Better - use findBy directly
expect(await screen.findByRole("alert")).toBeOnTheScreen();
```

### Wrapping Render in act()

```typescript
// Wrong - unnecessary act wrapper
await act(async () => {
  render(<Component />);
});

// Correct - render handles act internally
render(<Component />);
```

### Ignoring Return Value of Async Queries

```typescript
// Wrong - not awaiting
screen.findByRole("alert");
expect(screen.getByRole("alert")).toBeOnTheScreen();

// Correct - await the findBy
await screen.findByRole("alert");
expect(screen.getByRole("alert")).toBeOnTheScreen();

// Or better - use the returned element
const alert = await screen.findByRole("alert");
expect(alert).toBeOnTheScreen();
```

## userEvent and Async

### Setup with Fake Timers

```typescript
jest.useFakeTimers();

test("user interaction with fake timers", async () => {
  const user = userEvent.setup({
    advanceTimers: jest.advanceTimersByTime,
  });

  render(<Component />);
  await user.press(screen.getByRole("button", { name: "Click me" }));

  // Assertions...
});
```

### Awaiting userEvent Actions

All userEvent methods are async and must be awaited:

```typescript
const user = userEvent.setup();

// All interactions must be awaited
await user.press(button);
await user.type(input, "text");
await user.longPress(element);
await user.scroll(scrollView, { y: 100 });
```

### Sequential vs Parallel Interactions

```typescript
// Sequential - wait for each action
await user.type(emailInput, "test@example.com");
await user.type(passwordInput, "password123");
await user.press(submitButton);

// Don't use Promise.all for user interactions
// Users can only do one thing at a time
```

## Apollo GraphQL Async Patterns

### Mocking Query Responses

```typescript
const mocks = [
  {
    request: {
      query: GET_USER,
      variables: { id: "1" },
    },
    result: {
      data: {
        user: { id: "1", name: "John" },
      },
    },
  },
];

test("displays user data", async () => {
  render(
    <MockedProvider mocks={mocks}>
      <UserProfile userId="1" />
    </MockedProvider>
  );

  // Wait for data to load
  expect(await screen.findByText("John")).toBeOnTheScreen();
});
```

### Handling Loading and Error States

```typescript
test("shows loading then data", async () => {
  render(
    <MockedProvider mocks={mocks}>
      <UserProfile userId="1" />
    </MockedProvider>
  );

  // Initially shows loading
  expect(screen.getByRole("progressbar")).toBeOnTheScreen();

  // After data loads
  await waitForElementToBeRemoved(() => screen.queryByRole("progressbar"));
  expect(screen.getByText("John")).toBeOnTheScreen();
});

test("shows error on failure", async () => {
  const errorMocks = [
    {
      request: { query: GET_USER, variables: { id: "1" } },
      error: new Error("Failed to fetch"),
    },
  ];

  render(
    <MockedProvider mocks={errorMocks}>
      <UserProfile userId="1" />
    </MockedProvider>
  );

  expect(await screen.findByRole("alert")).toHaveTextContent("Failed to fetch");
});
```

## Timer Patterns

### Fake Timers Setup

```typescript
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});
```

### Advancing Timers

```typescript
// Advance by specific time
jest.advanceTimersByTime(1000);

// Run all pending timers
jest.runAllTimers();

// Run only pending timers (not new ones)
jest.runOnlyPendingTimers();

// Advance to next timer
jest.advanceTimersToNextTimer();
```

### Combining Timers with Async

```typescript
test("animation completes after delay", async () => {
  render(<AnimatedComponent />);

  expect(screen.getByTestId("animation")).toHaveStyle({ opacity: 0 });

  // Advance past animation duration
  jest.advanceTimersByTime(500);

  await waitFor(() => {
    expect(screen.getByTestId("animation")).toHaveStyle({ opacity: 1 });
  });
});
```

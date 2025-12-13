# UI Pattern: Click Outside to Close Menus

## The Problem

Using a fixed overlay to close dropdown menus blocks the entire viewport, including the sidebar navigation.

**Bad Pattern:**
```jsx
{showMenu && (
  <div
    className="fixed inset-0 z-0"
    onClick={() => setShowMenu(false)}
  />
)}
```

This creates an invisible layer over the entire screen. Even with `z-0`, it intercepts all click events before they reach the sidebar.

## The Solution

Use a `ref` and `useEffect` to detect clicks outside the menu element.

**Good Pattern:**
```jsx
import { useRef, useEffect } from "react";

// 1. Create ref
const menuRef = useRef<HTMLDivElement>(null);

// 2. Add click-outside handler
useEffect(() => {
  function handleClickOutside(event: MouseEvent) {
    if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
      setShowMenu(false);
    }
  }
  if (showMenu) {
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }
}, [showMenu]);

// 3. Attach ref to the menu container (includes button + dropdown)
<div className="relative" ref={menuRef}>
  <button onClick={() => setShowMenu(!showMenu)}>Toggle</button>
  {showMenu && (
    <div className="absolute ...">Menu content</div>
  )}
</div>
```

## Key Points

- Attach the ref to the **container** that holds both the trigger button and the dropdown
- Use `mousedown` event (fires before `click`, more reliable)
- Clean up the event listener in the useEffect return
- No fixed overlays needed

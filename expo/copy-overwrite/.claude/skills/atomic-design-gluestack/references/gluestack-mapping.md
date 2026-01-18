# Gluestack UI Component Classification

This document maps all Gluestack UI components to their atomic design level.

## Atoms (Foundation)

These components are the building blocks. Use them directly from `@/components/ui/`.

### Layout Atoms
| Component | Import | Description |
|-----------|--------|-------------|
| Box | `@/components/ui/box` | Basic container |
| Center | `@/components/ui/center` | Centered container |
| HStack | `@/components/ui/hstack` | Horizontal stack |
| VStack | `@/components/ui/vstack` | Vertical stack |
| Grid | `@/components/ui/grid` | Grid layout |
| Divider | `@/components/ui/divider` | Visual separator |

### Typography Atoms
| Component | Import | Description |
|-----------|--------|-------------|
| Text | `@/components/ui/text` | Body text |
| Heading | `@/components/ui/heading` | Headings h1-h6 |

### Interactive Atoms
| Component | Import | Description |
|-----------|--------|-------------|
| Button | `@/components/ui/button` | Clickable button |
| ButtonText | `@/components/ui/button` | Button label |
| ButtonIcon | `@/components/ui/button` | Button icon |
| ButtonSpinner | `@/components/ui/button` | Button loading state |
| Pressable | `@/components/ui/pressable` | Touchable wrapper |
| Link | `@/components/ui/link` | Navigation link |
| LinkText | `@/components/ui/link` | Link label |

### Input Atoms
| Component | Import | Description |
|-----------|--------|-------------|
| Input | `@/components/ui/input` | Text input container |
| InputField | `@/components/ui/input` | Text input field |
| InputSlot | `@/components/ui/input` | Input addon slot |
| InputIcon | `@/components/ui/input` | Input icon |
| Textarea | `@/components/ui/textarea` | Multi-line input |
| TextareaInput | `@/components/ui/textarea` | Textarea field |

### Selection Atoms
| Component | Import | Description |
|-----------|--------|-------------|
| Checkbox | `@/components/ui/checkbox` | Checkbox control |
| CheckboxIndicator | `@/components/ui/checkbox` | Checkbox visual |
| CheckboxIcon | `@/components/ui/checkbox` | Checkbox checkmark |
| CheckboxLabel | `@/components/ui/checkbox` | Checkbox text |
| Radio | `@/components/ui/radio` | Radio button |
| RadioIndicator | `@/components/ui/radio` | Radio visual |
| RadioIcon | `@/components/ui/radio` | Radio dot |
| RadioLabel | `@/components/ui/radio` | Radio text |
| Switch | `@/components/ui/switch` | Toggle switch |
| Slider | `@/components/ui/slider` | Range slider |

### Media Atoms
| Component | Import | Description |
|-----------|--------|-------------|
| Image | `@/components/ui/image` | Image display |
| Icon | `@/components/ui/icon` | Icon display |
| Avatar | `@/components/ui/avatar` | User avatar |
| AvatarImage | `@/components/ui/avatar` | Avatar image |
| AvatarFallbackText | `@/components/ui/avatar` | Avatar initials |

### Feedback Atoms
| Component | Import | Description |
|-----------|--------|-------------|
| Spinner | `@/components/ui/spinner` | Loading indicator |
| Badge | `@/components/ui/badge` | Status badge |
| BadgeText | `@/components/ui/badge` | Badge label |
| BadgeIcon | `@/components/ui/badge` | Badge icon |
| Progress | `@/components/ui/progress` | Progress bar |
| ProgressFilledTrack | `@/components/ui/progress` | Progress fill |

---

## Molecules (Simple Compositions)

These components combine atoms for a single purpose. Some Gluestack components are molecules.

### Form Molecules
| Component | Import | Description |
|-----------|--------|-------------|
| FormControl | `@/components/ui/form-control` | Form field wrapper |
| FormControlLabel | `@/components/ui/form-control` | Field label |
| FormControlLabelText | `@/components/ui/form-control` | Label text |
| FormControlHelper | `@/components/ui/form-control` | Helper text |
| FormControlHelperText | `@/components/ui/form-control` | Helper content |
| FormControlError | `@/components/ui/form-control` | Error container |
| FormControlErrorIcon | `@/components/ui/form-control` | Error icon |
| FormControlErrorText | `@/components/ui/form-control` | Error message |
| Select | `@/components/ui/select` | Dropdown select |
| SelectTrigger | `@/components/ui/select` | Select button |
| SelectInput | `@/components/ui/select` | Select display |
| SelectPortal | `@/components/ui/select` | Select dropdown |
| SelectItem | `@/components/ui/select` | Select option |

### Feedback Molecules
| Component | Import | Description |
|-----------|--------|-------------|
| Alert | `@/components/ui/alert` | Alert message |
| AlertIcon | `@/components/ui/alert` | Alert icon |
| AlertText | `@/components/ui/alert` | Alert content |
| Toast | `@/components/ui/toast` | Toast notification |
| ToastTitle | `@/components/ui/toast` | Toast heading |
| ToastDescription | `@/components/ui/toast` | Toast message |

### Content Molecules
| Component | Import | Description |
|-----------|--------|-------------|
| Card | `@/components/ui/card` | Content card |
| Tooltip | `@/components/ui/tooltip` | Hover tooltip |
| TooltipContent | `@/components/ui/tooltip` | Tooltip body |
| TooltipText | `@/components/ui/tooltip` | Tooltip text |
| Popover | `@/components/ui/popover` | Popover container |
| PopoverContent | `@/components/ui/popover` | Popover body |

---

## Organisms (Complex Sections)

These components form distinct interface sections and may contain multiple molecules.

### Overlay Organisms
| Component | Import | Description |
|-----------|--------|-------------|
| Modal | `@/components/ui/modal` | Modal dialog |
| ModalBackdrop | `@/components/ui/modal` | Modal overlay |
| ModalContent | `@/components/ui/modal` | Modal body |
| ModalHeader | `@/components/ui/modal` | Modal header |
| ModalBody | `@/components/ui/modal` | Modal content |
| ModalFooter | `@/components/ui/modal` | Modal actions |
| ModalCloseButton | `@/components/ui/modal` | Modal close |
| Actionsheet | `@/components/ui/actionsheet` | Bottom sheet |
| ActionsheetBackdrop | `@/components/ui/actionsheet` | Sheet overlay |
| ActionsheetContent | `@/components/ui/actionsheet` | Sheet body |
| ActionsheetItem | `@/components/ui/actionsheet` | Sheet option |
| ActionsheetItemText | `@/components/ui/actionsheet` | Option text |
| Drawer | `@/components/ui/drawer` | Side drawer |
| DrawerBackdrop | `@/components/ui/drawer` | Drawer overlay |
| DrawerContent | `@/components/ui/drawer` | Drawer body |

### Navigation Organisms
| Component | Import | Description |
|-----------|--------|-------------|
| Menu | `@/components/ui/menu` | Dropdown menu |
| MenuItem | `@/components/ui/menu` | Menu option |
| MenuItemLabel | `@/components/ui/menu` | Option text |
| Accordion | `@/components/ui/accordion` | Accordion list |
| AccordionItem | `@/components/ui/accordion` | Accordion section |
| AccordionHeader | `@/components/ui/accordion` | Section header |
| AccordionTrigger | `@/components/ui/accordion` | Section toggle |
| AccordionContent | `@/components/ui/accordion` | Section content |

### Feedback Organisms
| Component | Import | Description |
|-----------|--------|-------------|
| AlertDialog | `@/components/ui/alert-dialog` | Confirmation dialog |
| AlertDialogBackdrop | `@/components/ui/alert-dialog` | Dialog overlay |
| AlertDialogContent | `@/components/ui/alert-dialog` | Dialog body |
| AlertDialogHeader | `@/components/ui/alert-dialog` | Dialog header |
| AlertDialogBody | `@/components/ui/alert-dialog` | Dialog content |
| AlertDialogFooter | `@/components/ui/alert-dialog` | Dialog actions |
| AlertDialogCloseButton | `@/components/ui/alert-dialog` | Dialog close |

---

## Classification Decision Guide

When deciding which level a Gluestack component belongs to:

### Use as Atom when:
- It's a single, indivisible UI element
- It has no internal state management
- Examples: Button, Text, Icon, Input, Badge

### Use as Molecule when:
- It combines multiple atoms for one purpose
- It may have isolated UI state
- Examples: FormControl (label + input + error), Alert (icon + text)

### Use as Organism when:
- It forms a complete interface section
- It has multiple interactive parts
- Examples: Modal (backdrop + content + header + body + footer), Menu

### Composition Example

```typescript
// Page (in app/ or features/*/screens/)
export default function ProductScreen() {
  const { data } = useProductQuery();
  return (
    <MainLayout>                              {/* Template */}
      <ProductDetail product={data.product} /> {/* Organism */}
    </MainLayout>
  );
}

// Organism (in components/organisms/)
const ProductDetail = memo(function ProductDetail({ product }: Props) {
  return (
    <Card>                                     {/* Molecule */}
      <ProductImage src={product.image} />     {/* Atom */}
      <VStack>                                 {/* Atom */}
        <Heading>{product.name}</Heading>      {/* Atom */}
        <PriceDisplay price={product.price} /> {/* Molecule */}
        <AddToCartButton />                    {/* Molecule */}
      </VStack>
    </Card>
  );
});

// Molecule (in components/molecules/)
const PriceDisplay = memo(function PriceDisplay({ price, original }: Props) {
  return (
    <HStack space="sm">                        {/* Atom */}
      <Text className="text-primary-500">     {/* Atom */}
        ${price}
      </Text>
      {original && (
        <Text className="line-through">        {/* Atom */}
          ${original}
        </Text>
      )}
    </HStack>
  );
});
```

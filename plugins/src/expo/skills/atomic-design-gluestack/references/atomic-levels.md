# Atomic Design Levels - Detailed Reference

## Atoms

### Definition
The foundational building blocks of the interface - smallest functional UI elements that cannot be broken down further while remaining functional.

### Characteristics
- **Stateless**: No useState, useReducer, or other state hooks
- **Purely presentational**: Only render UI based on props
- **No business logic**: No calculations, transformations, or side effects
- **Highly reusable**: Used across the entire application
- **Single responsibility**: One visual element

### Examples

#### Good Atoms
```typescript
// ✅ Stateless, presentational
const AppBadge = memo(function AppBadge({ variant, children }: AppBadgeProps) {
  return (
    <Badge action={variant}>
      <BadgeText>{children}</BadgeText>
    </Badge>
  );
});

// ✅ Wrapper with default styling
const PrimaryButton = memo(function PrimaryButton({
  children,
  onPress
}: PrimaryButtonProps) {
  return (
    <Button action="primary" onPress={onPress}>
      <ButtonText>{children}</ButtonText>
    </Button>
  );
});
```

#### Bad Atoms (Anti-patterns)
```typescript
// ❌ Has state - should be a molecule
const ToggleButton = memo(function ToggleButton() {
  const [isOn, setIsOn] = useState(false); // WRONG: Atoms shouldn't have state
  return <Button onPress={() => setIsOn(!isOn)}>{isOn ? 'On' : 'Off'}</Button>;
});

// ❌ Fetches data - should be a page
const UserAvatar = memo(function UserAvatar({ userId }: { userId: string }) {
  const { data } = useUserQuery({ variables: { userId } }); // WRONG: No data fetching
  return <Avatar source={data?.user?.avatar} />;
});
```

---

## Molecules

### Definition
Simple groups of UI elements (atoms) functioning together as a unit, adhering to the single responsibility principle.

### Characteristics
- **Combines 2-5 atoms**: Simple composition
- **Single purpose**: Does one thing well
- **UI state allowed**: useState for toggles, form values, validation
- **No data fetching**: Receives all data via props
- **Reusable**: Can be used in multiple organisms

### Examples

#### Good Molecules
```typescript
// ✅ Combines atoms, has UI state, single purpose
const PasswordField = memo(function PasswordField({
  value,
  onChangeText,
  error
}: PasswordFieldProps) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <FormControl isInvalid={!!error}>
      <FormControlLabel>
        <FormControlLabelText>Password</FormControlLabelText>
      </FormControlLabel>
      <Input>
        <InputField
          type={showPassword ? "text" : "password"}
          value={value}
          onChangeText={onChangeText}
        />
        <InputSlot onPress={() => setShowPassword(!showPassword)}>
          <InputIcon as={showPassword ? EyeOffIcon : EyeIcon} />
        </InputSlot>
      </Input>
      {error && (
        <FormControlError>
          <FormControlErrorText>{error}</FormControlErrorText>
        </FormControlError>
      )}
    </FormControl>
  );
});

// ✅ Simple composition of atoms
const AvatarWithName = memo(function AvatarWithName({
  name,
  imageUrl,
  size = "md"
}: AvatarWithNameProps) {
  return (
    <HStack space="sm" className="items-center">
      <Avatar size={size}>
        <AvatarImage source={{ uri: imageUrl }} />
        <AvatarFallbackText>{name}</AvatarFallbackText>
      </Avatar>
      <Text size={size}>{name}</Text>
    </HStack>
  );
});
```

#### Bad Molecules (Anti-patterns)
```typescript
// ❌ Too complex - should be an organism
const UserProfile = memo(function UserProfile({ user }: UserProfileProps) {
  return (
    <VStack>
      <Avatar />
      <Text>{user.name}</Text>
      <Text>{user.email}</Text>
      <Text>{user.bio}</Text>
      <Button>Edit Profile</Button>
      <Button>Settings</Button>
      <RecentActivityList activities={user.activities} />
      <FriendsList friends={user.friends} />
    </VStack>
  );
});

// ❌ Fetches data - data fetching belongs in pages
const SearchResults = memo(function SearchResults({ query }: { query: string }) {
  const { data } = useSearchQuery({ variables: { query } }); // WRONG
  return <FlatList data={data?.results} />;
});
```

---

## Organisms

### Definition
Relatively complex components composed of molecules and atoms, forming distinct sections of the interface.

### Characteristics
- **Combines molecules and atoms**: Complex composition
- **Distinct interface section**: Has clear visual boundaries
- **Feature state allowed**: Can use custom hooks for feature logic
- **Coordinates children**: Manages interaction between child components
- **Receives data as props**: Does NOT fetch data itself

### Examples

#### Good Organisms
```typescript
// ✅ Distinct section, combines molecules, coordinates children
const ProductCard = memo(function ProductCard({
  product,
  onAddToCart,
  onFavorite
}: ProductCardProps) {
  const [quantity, setQuantity] = useState(1);

  const handleAddToCart = useCallback(() => {
    onAddToCart(product.id, quantity);
  }, [onAddToCart, product.id, quantity]);

  return (
    <Card variant="elevated">
      <ProductImage source={product.image} badge={product.isNew ? "New" : undefined} />
      <VStack space="sm" className="p-4">
        <HStack className="justify-between">
          <Heading size="sm">{product.name}</Heading>
          <FavoriteButton isFavorite={product.isFavorite} onPress={onFavorite} />
        </HStack>
        <PriceDisplay price={product.price} originalPrice={product.originalPrice} />
        <RatingStars rating={product.rating} reviewCount={product.reviewCount} />
        <QuantitySelector value={quantity} onChange={setQuantity} max={product.stock} />
        <Button onPress={handleAddToCart}>
          <ButtonText>Add to Cart</ButtonText>
        </Button>
      </VStack>
    </Card>
  );
});

// ✅ Navigation section with multiple molecules
const Header = memo(function Header({
  user,
  onSearch,
  onMenuPress,
  onNotificationsPress
}: HeaderProps) {
  return (
    <HStack className="items-center justify-between px-4 py-2 bg-background-0">
      <HStack space="md" className="items-center">
        <IconButton icon={MenuIcon} onPress={onMenuPress} />
        <AppLogo size="sm" />
      </HStack>
      <SearchField onSearch={onSearch} placeholder="Search..." />
      <HStack space="sm" className="items-center">
        <NotificationBadge count={user.unreadCount} onPress={onNotificationsPress} />
        <UserAvatarMenu user={user} />
      </HStack>
    </HStack>
  );
});
```

#### Bad Organisms (Anti-patterns)
```typescript
// ❌ Fetches data - should be in page
const ProductList = memo(function ProductList({ categoryId }: { categoryId: string }) {
  const { data, loading } = useProductsQuery({ variables: { categoryId } }); // WRONG
  return <FlatList data={data?.products} renderItem={...} />;
});

// ❌ Too simple - should be a molecule
const IconWithLabel = memo(function IconWithLabel({ icon, label }: IconWithLabelProps) {
  return (
    <VStack className="items-center">
      <Icon as={icon} />
      <Text>{label}</Text>
    </VStack>
  );
});
```

---

## Templates

### Definition
Page-level objects that place components into a layout, articulating the design's underlying content structure.

### Characteristics
- **Layout skeleton**: Defines where components go
- **No real content**: Uses children/slots, not actual data
- **Handles responsiveness**: Adapts layout to screen size
- **Layout state only**: Safe area, scroll position, layout dimensions
- **Reusable across pages**: Same layout, different content

### Examples

#### Good Templates
```typescript
// ✅ Layout skeleton with slots
const MainLayout = memo(function MainLayout({
  children,
  header,
  footer,
  showHeader = true,
  showFooter = true
}: MainLayoutProps) {
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-background-0" style={{ paddingTop: insets.top }}>
      {showHeader && (header || <Header />)}
      <KeyboardAvoidingView className="flex-1">
        <ScrollView className="flex-1" contentContainerClassName="pb-20">
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
      {showFooter && (footer || <TabBar />)}
    </View>
  );
});

// ✅ Auth-specific layout
const AuthLayout = memo(function AuthLayout({
  children,
  title,
  subtitle
}: AuthLayoutProps) {
  return (
    <SafeAreaView className="flex-1 bg-primary-500">
      <ScrollView contentContainerClassName="flex-1 justify-center p-6">
        <VStack space="xl" className="items-center">
          <AppLogo size="lg" variant="white" />
          {title && <Heading size="2xl" className="text-white">{title}</Heading>}
          {subtitle && <Text className="text-white/80">{subtitle}</Text>}
          <Card className="w-full max-w-md p-6">
            {children}
          </Card>
        </VStack>
      </ScrollView>
    </SafeAreaView>
  );
});
```

#### Bad Templates (Anti-patterns)
```typescript
// ❌ Has business logic - move to page
const DashboardLayout = memo(function DashboardLayout({ userId }: { userId: string }) {
  const { data } = useUserDashboardQuery({ variables: { userId } }); // WRONG
  return (
    <View>
      <Header user={data?.user} />
      <DashboardContent data={data?.dashboard} />
    </View>
  );
});

// ❌ Too specific - not reusable
const JohnsDashboardLayout = memo(function JohnsDashboardLayout() {
  return (
    <View>
      <Text>Welcome John!</Text>
      <JohnsSpecificContent />
    </View>
  );
});
```

---

## Pages

### Definition
Specific instances of templates that show what the UI looks like with real representative content.

### Characteristics
- **Real content**: Actual data, not placeholders
- **Data fetching**: Queries, mutations, subscriptions
- **Global state**: Connected to Apollo, Context, etc.
- **Route-specific**: One page per route
- **Passes data down**: Provides data to organisms/molecules

### Examples

#### Good Pages
```typescript
// ✅ Fetches data, uses template, passes data to children
export default function HomeScreen() {
  const { data, loading, error, refetch } = useHomeDataQuery();

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorScreen error={error} onRetry={refetch} />;

  return (
    <MainLayout>
      <VStack space="lg" className="p-4">
        <WelcomeBanner user={data.currentUser} />
        <FeaturedProducts products={data.featuredProducts} />
        <RecentOrders orders={data.recentOrders} />
        <RecommendedForYou items={data.recommendations} />
      </VStack>
    </MainLayout>
  );
}

// ✅ Form page with mutations
export default function CheckoutScreen() {
  const { cartItems, total } = useCart();
  const [createOrder, { loading }] = useCreateOrderMutation();
  const router = useRouter();

  const handleSubmit = useCallback(async (formData: CheckoutFormData) => {
    const result = await createOrder({ variables: { input: formData } });
    if (result.data?.createOrder.success) {
      router.push(`/orders/${result.data.createOrder.orderId}`);
    }
  }, [createOrder, router]);

  return (
    <MainLayout showFooter={false}>
      <CheckoutForm
        items={cartItems}
        total={total}
        onSubmit={handleSubmit}
        isSubmitting={loading}
      />
    </MainLayout>
  );
}
```

#### Bad Pages (Anti-patterns)
```typescript
// ❌ No data fetching - this is just an organism
export default function ProductListScreen() {
  return (
    <MainLayout>
      <ProductList /> {/* Where does data come from? */}
    </MainLayout>
  );
}

// ❌ Business logic that should be in a hook
export default function DashboardScreen() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/api/dashboard')
      .then(res => res.json())
      .then(json => {
        // 50 lines of data transformation... WRONG: Extract to hook
        setData(transformedData);
      });
  }, []);

  return <MainLayout>{/* ... */}</MainLayout>;
}
```

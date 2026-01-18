# Container/View Pattern - Complete Examples

## Example 1: Simple Button Component

### Directory Structure

```
AddButton/
├── AddButtonContainer.tsx
├── AddButtonView.tsx
└── index.tsx
```

### AddButtonContainer.tsx

```tsx
import { useCallback } from "react";

import AddButtonView from "./AddButtonView";

/**
 * Props for the AddButton component.
 */
interface AddButtonProps {
  /** Callback when button is pressed */
  readonly onAdd: () => void;
  /** Whether the button is disabled */
  readonly isDisabled?: boolean;
}

/**
 * Container component that manages the add button logic.
 * @param props - Component properties
 * @param props.onAdd - Callback when button is pressed
 * @param props.isDisabled - Whether the button is disabled
 */
const AddButtonContainer = ({ onAdd, isDisabled = false }: AddButtonProps) => {
  const handlePress = useCallback(() => {
    if (!isDisabled) {
      onAdd();
    }
  }, [onAdd, isDisabled]);

  return <AddButtonView onPress={handlePress} isDisabled={isDisabled} />;
};

export default AddButtonContainer;
```

### AddButtonView.tsx

```tsx
import { memo } from "react";
import { Plus } from "lucide-react-native";

import { Button, ButtonIcon, ButtonText } from "@/components/ui/button";

/**
 * Props for the AddButtonView component.
 */
interface AddButtonViewProps {
  /** Handler for button press */
  readonly onPress: () => void;
  /** Whether the button is disabled */
  readonly isDisabled: boolean;
}

/**
 * View component that renders the add button UI.
 * @param props - Component properties
 * @param props.onPress - Handler for button press
 * @param props.isDisabled - Whether the button is disabled
 */
const AddButtonView = ({ onPress, isDisabled }: AddButtonViewProps) => (
  <Button
    testID="ADD_BUTTON.BUTTON"
    onPress={onPress}
    isDisabled={isDisabled}
    className="flex-row items-center gap-2"
  >
    <ButtonIcon as={Plus} />
    <ButtonText>Add</ButtonText>
  </Button>
);

AddButtonView.displayName = "AddButtonView";

export default memo(AddButtonView);
```

### index.tsx

```tsx
export { default } from "./AddButtonContainer";
```

## Example 2: List with Loading/Empty States

### Directory Structure

```
PlayerList/
├── PlayerListContainer.tsx
├── PlayerListView.tsx
└── index.tsx
```

### PlayerListContainer.tsx

```tsx
import { useCallback, useMemo } from "react";
import { useRouter } from "expo-router";

import { useListPlayersQuery } from "@/generated/graphql";
import PlayerListView from "./PlayerListView";

/**
 * Props for the PlayerList component.
 */
interface PlayerListProps {
  /** Optional filter for player position */
  readonly positionFilter?: string;
}

/**
 * Container component that manages player list data and navigation.
 * @param props - Component properties
 * @param props.positionFilter - Optional filter for player position
 */
const PlayerListContainer = ({ positionFilter }: PlayerListProps) => {
  const router = useRouter();
  const { data, loading, error, refetch } = useListPlayersQuery();

  const players = useMemo(() => {
    const allPlayers = data?.listPlayers?.edges ?? [];
    if (!positionFilter) {
      return allPlayers;
    }
    return allPlayers.filter(p => p.position === positionFilter);
  }, [data?.listPlayers?.edges, positionFilter]);

  const isEmpty = useMemo(
    () => !loading && !error && players.length === 0,
    [loading, error, players.length]
  );

  const handlePlayerPress = useCallback(
    (playerId: string) => {
      if (!playerId) {
        console.error("Cannot navigate: player ID is missing");
        return;
      }
      router.push(`/players/${playerId}`);
    },
    [router]
  );

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  return (
    <PlayerListView
      players={players}
      isLoading={loading}
      hasError={!!error}
      isEmpty={isEmpty}
      onPlayerPress={handlePlayerPress}
      onRefresh={handleRefresh}
    />
  );
};

export default PlayerListContainer;
```

### PlayerListView.tsx

```tsx
import { memo } from "react";
import { FlashList, ListRenderItem } from "@shopify/flash-list";

import { Box } from "@/components/ui/box";
import { Text } from "@/components/ui/text";
import { Pressable } from "@/components/ui/pressable";
import { Spinner } from "@/components/ui/spinner";
import { PlayerFragment } from "@/generated/graphql";

/**
 * Props for the PlayerListView component.
 */
interface PlayerListViewProps {
  /** List of players to display */
  readonly players: readonly PlayerFragment[];
  /** Whether the list is loading */
  readonly isLoading: boolean;
  /** Whether there was an error loading */
  readonly hasError: boolean;
  /** Whether the list is empty */
  readonly isEmpty: boolean;
  /** Handler for player item press */
  readonly onPlayerPress: (playerId: string) => void;
  /** Handler for pull-to-refresh */
  readonly onRefresh: () => void;
}

/**
 * Renders a single player item.
 * @param props - Render item props
 * @param props.player - The player data
 * @param props.onPress - Press handler
 */
function renderPlayerItem(props: {
  readonly player: PlayerFragment;
  readonly onPress: (id: string) => void;
}) {
  const { player, onPress } = props;
  return (
    <Pressable
      testID={`PLAYER_LIST.ITEM.${player.id}`}
      onPress={() => onPress(player.id)}
      className="flex-row items-center gap-4 p-4"
    >
      <Text className="text-lg font-medium">{player.name}</Text>
      <Text className="text-sm text-gray-500">{player.position}</Text>
    </Pressable>
  );
}

/**
 * Renders the loading state.
 */
function renderLoading() {
  return (
    <Box className="flex-1 items-center justify-center">
      <Spinner size="large" />
    </Box>
  );
}

/**
 * Renders the error state.
 */
function renderError() {
  return (
    <Box className="flex-1 items-center justify-center p-8">
      <Text className="text-center text-red-500">
        Failed to load players. Pull to refresh.
      </Text>
    </Box>
  );
}

/**
 * Renders the empty state.
 */
function renderEmpty() {
  return (
    <Box className="flex-1 items-center justify-center p-8">
      <Text className="text-center text-gray-500">No players found</Text>
    </Box>
  );
}

/**
 * View component that renders the player list UI.
 * @param props - Component properties
 * @param props.players - List of players to display
 * @param props.isLoading - Whether the list is loading
 * @param props.hasError - Whether there was an error loading
 * @param props.isEmpty - Whether the list is empty
 * @param props.onPlayerPress - Handler for player item press
 * @param props.onRefresh - Handler for pull-to-refresh
 */
const PlayerListView = ({
  players,
  isLoading,
  hasError,
  isEmpty,
  onPlayerPress,
  onRefresh,
}: PlayerListViewProps) => (
  <Box testID="PLAYER_LIST.CONTAINER" className="flex-1">
    {isLoading ? (
      renderLoading()
    ) : hasError ? (
      renderError()
    ) : isEmpty ? (
      renderEmpty()
    ) : (
      <FlashList
        data={players}
        renderItem={({ item }) =>
          renderPlayerItem({ player: item, onPress: onPlayerPress })
        }
        estimatedItemSize={72}
        onRefresh={onRefresh}
        refreshing={isLoading}
      />
    )}
  </Box>
);

PlayerListView.displayName = "PlayerListView";

export default memo(PlayerListView);
```

### index.tsx

```tsx
export { default } from "./PlayerListContainer";
```

## Example 3: Form with Validation

### Directory Structure

```
EditProfile/
├── EditProfileContainer.tsx
├── EditProfileView.tsx
└── index.tsx
```

### EditProfileContainer.tsx

```tsx
import { useCallback, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";

import { useUpdateProfileMutation } from "@/generated/graphql";
import EditProfileView from "./EditProfileView";

/**
 * Form data shape for profile editing.
 */
interface ProfileFormData {
  readonly name: string;
  readonly email: string;
  readonly bio?: string;
}

const schema = yup.object({
  name: yup.string().required("Name is required"),
  email: yup.string().email("Invalid email").required("Email is required"),
  bio: yup.string().max(500, "Bio must be 500 characters or less"),
});

/**
 * Props for the EditProfile component.
 */
interface EditProfileProps {
  /** Initial profile data */
  readonly initialData: ProfileFormData;
  /** Callback when profile is saved */
  readonly onSaved: () => void;
}

/**
 * Container component that manages profile editing logic.
 * @param props - Component properties
 * @param props.initialData - Initial profile data
 * @param props.onSaved - Callback when profile is saved
 */
const EditProfileContainer = ({ initialData, onSaved }: EditProfileProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [updateProfile] = useUpdateProfileMutation();

  const {
    control,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<ProfileFormData>({
    resolver: yupResolver(schema),
    defaultValues: initialData,
  });

  const errorMessages = useMemo(
    () => ({
      name: errors.name?.message,
      email: errors.email?.message,
      bio: errors.bio?.message,
    }),
    [errors.name?.message, errors.email?.message, errors.bio?.message]
  );

  const handleFormSubmit = useCallback(
    async (data: ProfileFormData) => {
      setIsSubmitting(true);
      try {
        await updateProfile({ variables: { input: data } });
        onSaved();
      } catch (error) {
        console.error("Failed to update profile:", error);
      } finally {
        setIsSubmitting(false);
      }
    },
    [updateProfile, onSaved]
  );

  const onSubmit = useMemo(
    () => handleSubmit(handleFormSubmit),
    [handleSubmit, handleFormSubmit]
  );

  return (
    <EditProfileView
      control={control}
      errors={errorMessages}
      isSubmitting={isSubmitting}
      isDirty={isDirty}
      onSubmit={onSubmit}
    />
  );
};

export default EditProfileContainer;
```

### EditProfileView.tsx

```tsx
import { memo } from "react";
import { Control, Controller } from "react-hook-form";

import { Box } from "@/components/ui/box";
import { VStack } from "@/components/ui/vstack";
import { Text } from "@/components/ui/text";
import { Input, InputField } from "@/components/ui/input";
import { Textarea, TextareaInput } from "@/components/ui/textarea";
import { Button, ButtonText, ButtonSpinner } from "@/components/ui/button";

/**
 * Error messages for form fields.
 */
interface FormErrors {
  readonly name?: string;
  readonly email?: string;
  readonly bio?: string;
}

/**
 * Props for the EditProfileView component.
 */
interface EditProfileViewProps {
  /** React Hook Form control object */
  readonly control: Control<any>;
  /** Validation error messages */
  readonly errors: FormErrors;
  /** Whether the form is submitting */
  readonly isSubmitting: boolean;
  /** Whether the form has changes */
  readonly isDirty: boolean;
  /** Handler for form submission */
  readonly onSubmit: () => void;
}

/**
 * View component that renders the profile edit form UI.
 * @param props - Component properties
 * @param props.control - React Hook Form control object
 * @param props.errors - Validation error messages
 * @param props.isSubmitting - Whether the form is submitting
 * @param props.isDirty - Whether the form has changes
 * @param props.onSubmit - Handler for form submission
 */
const EditProfileView = ({
  control,
  errors,
  isSubmitting,
  isDirty,
  onSubmit,
}: EditProfileViewProps) => (
  <Box testID="EDIT_PROFILE.CONTAINER" className="flex-1 p-4">
    <VStack space="lg">
      <VStack space="xs">
        <Text className="font-medium">Name</Text>
        <Controller
          control={control}
          name="name"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input isInvalid={!!errors.name}>
              <InputField
                testID="EDIT_PROFILE.NAME_INPUT"
                placeholder="Enter your name"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
              />
            </Input>
          )}
        />
        {errors.name && (
          <Text className="text-sm text-red-500">{errors.name}</Text>
        )}
      </VStack>

      <VStack space="xs">
        <Text className="font-medium">Email</Text>
        <Controller
          control={control}
          name="email"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input isInvalid={!!errors.email}>
              <InputField
                testID="EDIT_PROFILE.EMAIL_INPUT"
                placeholder="Enter your email"
                keyboardType="email-address"
                autoCapitalize="none"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
              />
            </Input>
          )}
        />
        {errors.email && (
          <Text className="text-sm text-red-500">{errors.email}</Text>
        )}
      </VStack>

      <VStack space="xs">
        <Text className="font-medium">Bio</Text>
        <Controller
          control={control}
          name="bio"
          render={({ field: { onChange, onBlur, value } }) => (
            <Textarea isInvalid={!!errors.bio}>
              <TextareaInput
                testID="EDIT_PROFILE.BIO_INPUT"
                placeholder="Tell us about yourself"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
              />
            </Textarea>
          )}
        />
        {errors.bio && (
          <Text className="text-sm text-red-500">{errors.bio}</Text>
        )}
      </VStack>

      <Button
        testID="EDIT_PROFILE.SUBMIT_BUTTON"
        onPress={onSubmit}
        isDisabled={!isDirty || isSubmitting}
      >
        {isSubmitting ? (
          <ButtonSpinner />
        ) : (
          <ButtonText>Save Changes</ButtonText>
        )}
      </Button>
    </VStack>
  </Box>
);

EditProfileView.displayName = "EditProfileView";

export default memo(EditProfileView);
```

### index.tsx

```tsx
export { default } from "./EditProfileContainer";
```

## Example 4: Modal with Confirmation

### Directory Structure

```
DeleteConfirmModal/
├── DeleteConfirmModalContainer.tsx
├── DeleteConfirmModalView.tsx
└── index.tsx
```

### DeleteConfirmModalContainer.tsx

```tsx
import { useCallback, useState } from "react";

import DeleteConfirmModalView from "./DeleteConfirmModalView";

/**
 * Props for the DeleteConfirmModal component.
 */
interface DeleteConfirmModalProps {
  /** Whether the modal is visible */
  readonly isOpen: boolean;
  /** Name of the item being deleted */
  readonly itemName: string;
  /** Handler for delete confirmation */
  readonly onConfirm: () => Promise<void>;
  /** Handler for modal close */
  readonly onClose: () => void;
}

/**
 * Container component that manages delete confirmation modal logic.
 * @param props - Component properties
 * @param props.isOpen - Whether the modal is visible
 * @param props.itemName - Name of the item being deleted
 * @param props.onConfirm - Handler for delete confirmation
 * @param props.onClose - Handler for modal close
 */
const DeleteConfirmModalContainer = ({
  isOpen,
  itemName,
  onConfirm,
  onClose,
}: DeleteConfirmModalProps) => {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = useCallback(async () => {
    setIsDeleting(true);
    try {
      await onConfirm();
      onClose();
    } catch (error) {
      console.error("Delete failed:", error);
    } finally {
      setIsDeleting(false);
    }
  }, [onConfirm, onClose]);

  const handleCancel = useCallback(() => {
    if (!isDeleting) {
      onClose();
    }
  }, [isDeleting, onClose]);

  return (
    <DeleteConfirmModalView
      isOpen={isOpen}
      itemName={itemName}
      isDeleting={isDeleting}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );
};

export default DeleteConfirmModalContainer;
```

### DeleteConfirmModalView.tsx

```tsx
import { memo } from "react";

import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogBody,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { Button, ButtonText, ButtonSpinner } from "@/components/ui/button";
import { HStack } from "@/components/ui/hstack";

/**
 * Props for the DeleteConfirmModalView component.
 */
interface DeleteConfirmModalViewProps {
  /** Whether the modal is visible */
  readonly isOpen: boolean;
  /** Name of the item being deleted */
  readonly itemName: string;
  /** Whether deletion is in progress */
  readonly isDeleting: boolean;
  /** Handler for confirm button */
  readonly onConfirm: () => void;
  /** Handler for cancel button */
  readonly onCancel: () => void;
}

/**
 * View component that renders the delete confirmation modal UI.
 * @param props - Component properties
 * @param props.isOpen - Whether the modal is visible
 * @param props.itemName - Name of the item being deleted
 * @param props.isDeleting - Whether deletion is in progress
 * @param props.onConfirm - Handler for confirm button
 * @param props.onCancel - Handler for cancel button
 */
const DeleteConfirmModalView = ({
  isOpen,
  itemName,
  isDeleting,
  onConfirm,
  onCancel,
}: DeleteConfirmModalViewProps) => (
  <AlertDialog isOpen={isOpen} onClose={onCancel}>
    <AlertDialogBackdrop />
    <AlertDialogContent testID="DELETE_CONFIRM_MODAL.CONTENT">
      <AlertDialogHeader>
        <Heading size="lg">Delete {itemName}?</Heading>
      </AlertDialogHeader>
      <AlertDialogBody>
        <Text>
          This action cannot be undone. Are you sure you want to delete{" "}
          <Text className="font-bold">{itemName}</Text>?
        </Text>
      </AlertDialogBody>
      <AlertDialogFooter>
        <HStack space="md">
          <Button
            testID="DELETE_CONFIRM_MODAL.CANCEL_BUTTON"
            variant="outline"
            onPress={onCancel}
            isDisabled={isDeleting}
          >
            <ButtonText>Cancel</ButtonText>
          </Button>
          <Button
            testID="DELETE_CONFIRM_MODAL.CONFIRM_BUTTON"
            action="negative"
            onPress={onConfirm}
            isDisabled={isDeleting}
          >
            {isDeleting ? <ButtonSpinner /> : <ButtonText>Delete</ButtonText>}
          </Button>
        </HStack>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

DeleteConfirmModalView.displayName = "DeleteConfirmModalView";

export default memo(DeleteConfirmModalView);
```

### index.tsx

```tsx
export { default } from "./DeleteConfirmModalContainer";
```

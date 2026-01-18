#!/usr/bin/env bash
set -euo pipefail

LISA_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST_DIR=""
DRY_RUN=false
YES_MODE=false
VALIDATE_ONLY=false
UNINSTALL_MODE=false
BACKUP_DIR=""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
COPIED=0
SKIPPED=0
OVERWRITTEN=0
APPENDED=0
MERGED=0

# Detected project types
DETECTED_TYPES=()

# Manifest file to track installed files (for uninstall)
MANIFEST_FILE=""

# Check required dependencies
check_dependencies() {
    local missing=()

    if ! command -v jq &> /dev/null; then
        missing+=("jq")
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        echo -e "\033[0;31m[ERROR]\033[0m Missing required dependencies: ${missing[*]}"
        echo ""
        echo "Installation instructions:"
        if [[ "$(uname)" == "Darwin" ]]; then
            echo "  brew install ${missing[*]}"
        else
            echo "  apt install ${missing[*]}  # Debian/Ubuntu"
            echo "  yum install ${missing[*]}  # RHEL/CentOS"
            echo "  pacman -S ${missing[*]}    # Arch Linux"
        fi
        exit 1
    fi
}

# Get parent type for a given type (bash 3.2 compatible)
get_parent_type() {
    case "$1" in
        expo|nestjs|cdk) echo "typescript" ;;
        *) echo "" ;;
    esac
}

# Check if array contains a value
array_contains() {
    local needle="$1"
    shift
    for item in "$@"; do
        [[ "$item" == "$needle" ]] && return 0
    done
    return 1
}

usage() {
    echo "Usage: $0 [options] <destination-path>"
    echo ""
    echo "Bootstrap or update a project with Lisa configurations."
    echo ""
    echo "Options:"
    echo "  -n, --dry-run     Show what would be done without making changes"
    echo "  -y, --yes         Non-interactive mode (auto-accept defaults, overwrite on conflict)"
    echo "  -v, --validate    Validate project compatibility without applying changes"
    echo "  -u, --uninstall   Remove Lisa-managed files from the project"
    echo "  -h, --help        Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 /path/to/my-project"
    echo "  $0 --dry-run ."
    echo "  $0 --yes /path/to/project    # CI/CD pipeline usage"
    echo "  $0 --validate .              # Check compatibility only"
    echo "  $0 --uninstall .             # Remove Lisa configurations"
    exit 1
}

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_dry() {
    echo -e "${BLUE}[DRY-RUN]${NC} $1"
}

# Initialize backup directory for atomic transactions
init_backup() {
    if [[ "$DRY_RUN" == "true" ]]; then
        return
    fi
    BACKUP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/lisa-backup.XXXXXX")
    log_info "Backup directory: $BACKUP_DIR"
}

# Backup a file before modifying it
backup_file() {
    local file="$1"
    if [[ "$DRY_RUN" == "true" ]] || [[ -z "$BACKUP_DIR" ]]; then
        return
    fi
    if [[ -f "$file" ]]; then
        local rel_path="${file#$DEST_DIR/}"
        local backup_path="$BACKUP_DIR/$rel_path"
        local backup_parent
        backup_parent="$(dirname "$backup_path")"
        mkdir -p "$backup_parent"
        cp "$file" "$backup_path"
    fi
}

# Rollback all changes from backup
rollback() {
    if [[ -z "$BACKUP_DIR" ]] || [[ ! -d "$BACKUP_DIR" ]]; then
        return 1
    fi
    log_warn "Rolling back changes..."

    # Restore all backed up files
    while IFS= read -r -d '' backup_file; do
        local rel_path="${backup_file#$BACKUP_DIR/}"
        local dest_file="$DEST_DIR/$rel_path"
        cp "$backup_file" "$dest_file"
        log_info "Restored: $rel_path"
    done < <(find "$BACKUP_DIR" -type f -print0)

    cleanup_backup
    log_success "Rollback complete"
}

# Cleanup backup directory on success
cleanup_backup() {
    if [[ -n "$BACKUP_DIR" ]] && [[ -d "$BACKUP_DIR" ]]; then
        rm -rf "$BACKUP_DIR"
        BACKUP_DIR=""
    fi
}

# Trap to handle failures and rollback
handle_error() {
    local exit_code=$?
    if [[ $exit_code -ne 0 ]] && [[ -n "$BACKUP_DIR" ]]; then
        log_error "Operation failed with exit code $exit_code"
        rollback
    fi
    exit $exit_code
}

# Initialize manifest file for tracking installed files
init_manifest() {
    if [[ "$DRY_RUN" == "true" ]]; then
        return
    fi
    MANIFEST_FILE="$DEST_DIR/.lisa-manifest"
    # Create or clear manifest file
    echo "# Lisa manifest - DO NOT EDIT" > "$MANIFEST_FILE"
    echo "# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")" >> "$MANIFEST_FILE"
    echo "# Lisa directory: $LISA_DIR" >> "$MANIFEST_FILE"
    echo "" >> "$MANIFEST_FILE"
}

# Record a file in the manifest
record_file() {
    local rel_path="$1"
    local strategy="$2"
    if [[ -n "$MANIFEST_FILE" ]] && [[ -f "$MANIFEST_FILE" ]]; then
        echo "$strategy:$rel_path" >> "$MANIFEST_FILE"
    fi
}

# Uninstall Lisa-managed files
uninstall_lisa() {
    local manifest="$DEST_DIR/.lisa-manifest"
    local removed=0
    local skipped=0
    local errors=0

    if [[ ! -f "$manifest" ]]; then
        log_error "No Lisa manifest found at: $manifest"
        log_info "This project may not have been bootstrapped with Lisa, or the manifest was deleted."
        exit 1
    fi

    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}    Lisa Uninstaller${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    log_info "Reading manifest: $manifest"
    echo ""

    # Read manifest and process files
    while IFS=: read -r strategy rel_path || [[ -n "$strategy" ]]; do
        # Skip comments and empty lines
        [[ "$strategy" =~ ^#.*$ ]] && continue
        [[ -z "$strategy" ]] && continue

        local dest_file="$DEST_DIR/$rel_path"

        case "$strategy" in
            copy-overwrite|create-only)
                # These files can be safely removed
                if [[ -f "$dest_file" ]]; then
                    if [[ "$DRY_RUN" == "true" ]]; then
                        log_dry "Would remove: $rel_path"
                    else
                        rm -f "$dest_file"
                        log_success "Removed: $rel_path"
                    fi
                    ((removed++))
                else
                    ((skipped++))
                fi
                ;;
            copy-contents)
                # Cannot safely remove - would need to diff
                log_warn "Cannot auto-remove (copy-contents): $rel_path"
                log_info "  Manually review and remove added lines if needed."
                ((skipped++))
                ;;
            merge)
                # Cannot safely remove merged JSON
                log_warn "Cannot auto-remove (merged JSON): $rel_path"
                log_info "  Manually remove Lisa-added keys if needed."
                ((skipped++))
                ;;
            *)
                ((skipped++))
                ;;
        esac
    done < "$manifest"

    # Remove empty directories left behind
    if [[ "$DRY_RUN" == "false" ]]; then
        # Find and remove empty directories (except .git and node_modules)
        find "$DEST_DIR" -type d -empty \
            -not -path "*/.git/*" \
            -not -path "*/node_modules/*" \
            -not -path "$DEST_DIR" \
            -delete 2>/dev/null || true

        # Remove manifest file itself
        rm -f "$manifest"
        log_success "Removed manifest file"
    fi

    echo ""
    echo -e "${GREEN}========================================${NC}"
    if [[ "$DRY_RUN" == "true" ]]; then
        echo -e "${GREEN}    Lisa Uninstall Dry Run Complete${NC}"
    else
        echo -e "${GREEN}    Lisa Uninstall Complete!${NC}"
    fi
    echo -e "${GREEN}========================================${NC}"
    echo ""
    printf "  ${GREEN}Removed:${NC}     %3d files\n" "$removed"
    printf "  ${YELLOW}Skipped:${NC}     %3d files (manual review needed)\n" "$skipped"
    echo ""

    exit 0
}

# Check if two files are identical (using cmp -s for better portability)
files_identical() {
    local src="$1"
    local dest="$2"
    cmp -s "$src" "$dest"
}

# Check if running in non-interactive mode (no TTY or YES_MODE enabled)
is_interactive() {
    [[ "$YES_MODE" == "false" ]] && [[ -t 0 ]]
}

# Prompt user for overwrite decision
prompt_overwrite() {
    local file="$1"
    local choice

    # In YES_MODE or non-interactive, auto-accept overwrites
    if ! is_interactive; then
        log_info "Auto-accepting overwrite (non-interactive): $file"
        return 0
    fi

    while true; do
        echo -e "${YELLOW}File differs:${NC} $file"
        read -rp "  Overwrite? [y]es / [n]o / [d]iff: " choice
        case "$choice" in
            [yY]|[yY][eE][sS])
                return 0
                ;;
            [nN]|[nN][oO])
                return 1
                ;;
            [dD]|[dD][iI][fF][fF])
                echo "--- Differences ---"
                diff "$2" "$1" || true
                echo "-------------------"
                ;;
            *)
                echo "Please answer y(es), n(o), or d(iff)"
                ;;
        esac
    done
}

# Ensure parent directory exists
ensure_parent_dir() {
    local file="$1"
    local parent_dir
    parent_dir="$(dirname "$file")"
    if [[ ! -d "$parent_dir" ]] && [[ "$DRY_RUN" == "false" ]]; then
        mkdir -p "$parent_dir"
    fi
}

# Copy with overwrite strategy
copy_overwrite() {
    local src="$1"
    local dest="$2"
    local rel_path="$3"

    if [[ ! -f "$dest" ]]; then
        # Destination doesn't exist - copy silently
        if [[ "$DRY_RUN" == "true" ]]; then
            log_dry "Would copy: $rel_path"
        else
            ensure_parent_dir "$dest"
            cp "$src" "$dest"
            record_file "$rel_path" "copy-overwrite"
            log_success "Copied: $rel_path"
        fi
        ((++COPIED))
    elif files_identical "$src" "$dest"; then
        # Files are identical - still record for uninstall tracking
        record_file "$rel_path" "copy-overwrite"
        ((++SKIPPED))
    else
        # Files differ - prompt (or just report in dry run)
        if [[ "$DRY_RUN" == "true" ]]; then
            log_dry "Would prompt to overwrite: $rel_path"
            ((++OVERWRITTEN))
        elif prompt_overwrite "$rel_path" "$dest" "$src"; then
            backup_file "$dest"
            cp "$src" "$dest"
            record_file "$rel_path" "copy-overwrite"
            ((++OVERWRITTEN))
            log_success "Overwritten: $rel_path"
        else
            ((++SKIPPED))
            log_warn "Skipped: $rel_path"
        fi
    fi
}

# Copy with create-only strategy
copy_create_only() {
    local src="$1"
    local dest="$2"
    local rel_path="$3"

    if [[ ! -f "$dest" ]]; then
        # Destination doesn't exist - copy silently
        if [[ "$DRY_RUN" == "true" ]]; then
            log_dry "Would create: $rel_path"
        else
            ensure_parent_dir "$dest"
            cp "$src" "$dest"
            record_file "$rel_path" "create-only"
            log_success "Created: $rel_path"
        fi
        ((++COPIED))
    else
        # Destination exists - skip silently (whether identical or different)
        ((++SKIPPED))
    fi
}

# Copy with copy-contents strategy (append missing lines)
# Optimized to O(n log n) using comm instead of O(n²) grep loop
copy_contents() {
    local src="$1"
    local dest="$2"
    local rel_path="$3"

    if [[ ! -f "$dest" ]]; then
        # Destination doesn't exist - copy silently
        if [[ "$DRY_RUN" == "true" ]]; then
            log_dry "Would copy: $rel_path"
        else
            ensure_parent_dir "$dest"
            cp "$src" "$dest"
            record_file "$rel_path" "copy-contents"
            log_success "Copied: $rel_path"
        fi
        ((++COPIED))
    elif files_identical "$src" "$dest"; then
        # Files are identical - still record for tracking
        record_file "$rel_path" "copy-contents"
        ((++SKIPPED))
    else
        # Find lines in src that are not in dest using comm (O(n log n))
        # Filter out empty lines from src before comparison
        local new_lines
        new_lines=$(comm -23 <(grep -v '^$' "$src" | sort -u) <(sort -u "$dest") 2>/dev/null || true)

        if [[ -n "$new_lines" ]]; then
            local added_lines
            added_lines=$(echo "$new_lines" | wc -l | tr -d ' ')

            if [[ "$DRY_RUN" == "true" ]]; then
                log_dry "Would append $added_lines lines to: $rel_path"
            else
                backup_file "$dest"
                echo "$new_lines" >> "$dest"
                record_file "$rel_path" "copy-contents"
                log_success "Appended $added_lines lines to: $rel_path"
            fi
            ((++APPENDED))
        else
            record_file "$rel_path" "copy-contents"
            ((++SKIPPED))
        fi
    fi
}

# Deep merge JSON function for jq
# Lisa values serve as defaults, project (dest) values take precedence
JQ_DEEP_MERGE='
def deepmerge(base; override):
  if (base | type) == "object" and (override | type) == "object" then
    base + (override | to_entries | map(
      {(.key): deepmerge(base[.key]; .value)}
    ) | add // {})
  else
    override // base
  end;
deepmerge(.[0]; .[1])
'

# Merge JSON files (Lisa provides defaults, project values take precedence)
merge_json() {
    local src="$1"
    local dest="$2"
    local rel_path="$3"

    if [[ ! -f "$dest" ]]; then
        # Destination doesn't exist - copy the file
        if [[ "$DRY_RUN" == "true" ]]; then
            log_dry "Would copy: $rel_path"
        else
            ensure_parent_dir "$dest"
            cp "$src" "$dest"
            record_file "$rel_path" "merge"
            log_success "Copied: $rel_path"
        fi
        ((++COPIED))
    else
        # Deep merge: Lisa values as defaults, project values win conflicts
        local merged
        local merge_output
        merge_output=$(jq -s "$JQ_DEEP_MERGE" "$src" "$dest" 2>&1)
        local merge_status=$?
        if [[ $merge_status -ne 0 ]]; then
            log_error "Failed to merge JSON: $rel_path"
            log_error "Details: $merge_output"
            return 1
        fi
        merged="$merge_output"

        # Check if anything changed
        local current
        current=$(cat "$dest")
        if [[ "$merged" == "$current" ]]; then
            record_file "$rel_path" "merge"
            ((++SKIPPED))
        else
            if [[ "$DRY_RUN" == "true" ]]; then
                log_dry "Would merge: $rel_path"
            else
                backup_file "$dest"
                echo "$merged" > "$dest"
                record_file "$rel_path" "merge"
                log_success "Merged: $rel_path"
            fi
            ((++MERGED))
        fi
    fi
}

# Process a directory with given strategy
process_directory() {
    local src_dir="$1"
    local strategy="$2"

    [[ ! -d "$src_dir" ]] && return

    # Find all files in the source directory
    while IFS= read -r -d '' src_file; do
        local rel_path="${src_file#$src_dir/}"
        local dest_file="$DEST_DIR/$rel_path"

        case "$strategy" in
            copy-overwrite)
                copy_overwrite "$src_file" "$dest_file" "$rel_path"
                ;;
            copy-contents)
                copy_contents "$src_file" "$dest_file" "$rel_path"
                ;;
            create-only)
                copy_create_only "$src_file" "$dest_file" "$rel_path"
                ;;
            merge)
                merge_json "$src_file" "$dest_file" "$rel_path"
                ;;
        esac
    done < <(find "$src_dir" -type f -print0)
}

# Check if a file is valid JSON
is_valid_json() {
    local file="$1"
    [[ -f "$file" ]] && jq empty "$file" 2>/dev/null
}

# Check if package.json contains a dependency (validates JSON first)
has_dependency() {
    local pkg="$1"
    local pkg_json="$DEST_DIR/package.json"

    # Validate JSON before checking
    if ! is_valid_json "$pkg_json"; then
        return 1
    fi

    # Check in dependencies and devDependencies
    jq -e ".dependencies[\"$pkg\"] // .devDependencies[\"$pkg\"]" "$pkg_json" >/dev/null 2>&1
}

# Detect project types from destination
detect_project_types() {
    local types=()
    local pkg_json="$DEST_DIR/package.json"
    local pkg_json_valid=false

    # Pre-validate package.json once
    if is_valid_json "$pkg_json"; then
        pkg_json_valid=true
    fi

    # TypeScript detection
    if [[ -f "$DEST_DIR/tsconfig.json" ]] ||
       ($pkg_json_valid && has_dependency "typescript"); then
        types+=("typescript")
    fi

    # Expo detection
    if [[ -f "$DEST_DIR/app.json" ]] ||
       [[ -f "$DEST_DIR/eas.json" ]] ||
       ($pkg_json_valid && has_dependency "expo"); then
        types+=("expo")
    fi

    # NestJS detection
    if [[ -f "$DEST_DIR/nest-cli.json" ]] ||
       ($pkg_json_valid && jq -e '.dependencies | keys | any(startswith("@nestjs"))' "$pkg_json" >/dev/null 2>&1) ||
       ($pkg_json_valid && jq -e '.devDependencies | keys | any(startswith("@nestjs"))' "$pkg_json" >/dev/null 2>&1); then
        types+=("nestjs")
    fi

    # CDK detection
    if [[ -f "$DEST_DIR/cdk.json" ]] ||
       ($pkg_json_valid && jq -e '.dependencies | keys | any(startswith("aws-cdk"))' "$pkg_json" >/dev/null 2>&1) ||
       ($pkg_json_valid && jq -e '.devDependencies | keys | any(startswith("aws-cdk"))' "$pkg_json" >/dev/null 2>&1); then
        types+=("cdk")
    fi

    DETECTED_TYPES=("${types[@]+"${types[@]}"}")
}

# Expand types to include parent types and order correctly
expand_and_order_types() {
    local all_types=()
    local parent

    # Add all detected types and their parents
    for type in "${DETECTED_TYPES[@]+"${DETECTED_TYPES[@]}"}"; do
        if array_contains "$type" "${all_types[@]+"${all_types[@]}"}"; then
            : # already present, skip
        else
            all_types+=("$type")
        fi
        parent=$(get_parent_type "$type")
        if [[ -n "$parent" ]]; then
            if array_contains "$parent" "${all_types[@]+"${all_types[@]}"}"; then
                : # already present, skip
            else
                all_types+=("$parent")
            fi
        fi
    done

    # Rebuild DETECTED_TYPES in correct order (typescript first, then others)
    DETECTED_TYPES=()
    for type in typescript expo nestjs cdk; do
        if array_contains "$type" "${all_types[@]+"${all_types[@]}"}"; then
            DETECTED_TYPES+=("$type")
        fi
    done
}

# Trim leading and trailing whitespace using parameter expansion
trim() {
    local var="$1"
    # Remove leading whitespace
    var="${var#"${var%%[![:space:]]*}"}"
    # Remove trailing whitespace
    var="${var%"${var##*[![:space:]]}"}"
    echo "$var"
}

# Display detected types and let user confirm/modify
confirm_project_types() {
    # Expand and order before showing to user
    expand_and_order_types

    echo ""
    if [[ ${#DETECTED_TYPES[@]} -eq 0 ]]; then
        echo -e "${YELLOW}No specific project types detected.${NC}"
    else
        echo -e "Detected project types: ${GREEN}${DETECTED_TYPES[*]}${NC}"
    fi

    # Skip prompt in non-interactive mode
    if ! is_interactive; then
        log_info "Using detected types (non-interactive mode)"
        echo ""
        return
    fi

    echo ""
    echo "Available types: typescript, expo, nestjs, cdk"
    echo "(Child types automatically include parents: expo/nestjs/cdk → typescript)"
    read -rp "Press Enter to confirm, or type types to override (comma-separated): " override

    if [[ -n "$override" ]]; then
        # Parse comma-separated input
        IFS=',' read -ra DETECTED_TYPES <<< "$override"
        # Trim whitespace from each element using parameter expansion
        for i in "${!DETECTED_TYPES[@]}"; do
            DETECTED_TYPES[$i]=$(trim "${DETECTED_TYPES[$i]}")
        done
        # Expand and order the overridden types too
        expand_and_order_types
        echo -e "Using project types: ${GREEN}${DETECTED_TYPES[*]}${NC}"
    fi
    echo ""
}

# Process all files for given project type
process_project_type() {
    local type_dir="$1"

    for strategy in copy-overwrite copy-contents create-only merge; do
        local src_dir="$LISA_DIR/$type_dir/$strategy"
        if [[ -d "$src_dir" ]]; then
            log_info "Processing $type_dir/$strategy..."
            process_directory "$src_dir" "$strategy"
        fi
    done
}

# Print final summary
print_summary() {
    echo ""
    echo -e "${GREEN}========================================${NC}"
    if [[ "$VALIDATE_ONLY" == "true" ]]; then
        echo -e "${GREEN}    Lisa Validation Complete${NC}"
    elif [[ "$DRY_RUN" == "true" ]]; then
        echo -e "${GREEN}    Lisa Dry Run Complete${NC}"
    else
        echo -e "${GREEN}    Lisa Installation Complete!${NC}"
    fi
    echo -e "${GREEN}========================================${NC}"
    echo ""
    if [[ "$VALIDATE_ONLY" == "true" ]]; then
        printf "  ${GREEN}Compatible files:${NC}    %3d files\n" "$COPIED"
        printf "  ${BLUE}Already present:${NC}     %3d files\n" "$SKIPPED"
        printf "  ${YELLOW}Would conflict:${NC}      %3d files\n" "$OVERWRITTEN"
        printf "  ${BLUE}Would append:${NC}        %3d files\n" "$APPENDED"
        printf "  ${GREEN}Would merge:${NC}         %3d files\n" "$MERGED"
    elif [[ "$DRY_RUN" == "true" ]]; then
        printf "  ${GREEN}Would copy:${NC}      %3d files\n" "$COPIED"
        printf "  ${BLUE}Would skip:${NC}      %3d files (identical or create-only)\n" "$SKIPPED"
        printf "  ${YELLOW}Would prompt:${NC}    %3d files (differ)\n" "$OVERWRITTEN"
        printf "  ${BLUE}Would append:${NC}    %3d files (copy-contents)\n" "$APPENDED"
        printf "  ${GREEN}Would merge:${NC}     %3d files (JSON)\n" "$MERGED"
    else
        printf "  ${GREEN}Copied:${NC}      %3d files\n" "$COPIED"
        printf "  ${BLUE}Skipped:${NC}     %3d files (identical or create-only)\n" "$SKIPPED"
        printf "  ${YELLOW}Overwritten:${NC} %3d files (user approved)\n" "$OVERWRITTEN"
        printf "  ${BLUE}Appended:${NC}    %3d files (copy-contents)\n" "$APPENDED"
        printf "  ${GREEN}Merged:${NC}      %3d files (JSON merged)\n" "$MERGED"
    fi
    echo ""
    if [[ ${#DETECTED_TYPES[@]} -gt 0 ]]; then
        echo -e "Project types: ${GREEN}${DETECTED_TYPES[*]}${NC}"
    else
        echo -e "Project types: ${YELLOW}(none detected - only 'all' was applied)${NC}"
    fi
    echo ""

    # Validation result for CI/CD
    if [[ "$VALIDATE_ONLY" == "true" ]]; then
        if [[ $OVERWRITTEN -gt 0 ]]; then
            log_warn "Validation found $OVERWRITTEN file(s) that would conflict"
            echo "Run without --validate to apply changes interactively"
        else
            log_success "Project is compatible with Lisa configurations"
        fi
    fi
}

# Main execution
main() {
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -n|--dry-run)
                DRY_RUN=true
                shift
                ;;
            -y|--yes)
                YES_MODE=true
                shift
                ;;
            -v|--validate)
                VALIDATE_ONLY=true
                DRY_RUN=true  # Validate mode is effectively a dry run
                shift
                ;;
            -u|--uninstall)
                UNINSTALL_MODE=true
                shift
                ;;
            -h|--help)
                usage
                ;;
            -*)
                log_error "Unknown option: $1"
                usage
                ;;
            *)
                DEST_DIR="$1"
                shift
                ;;
        esac
    done

    if [[ -z "$DEST_DIR" ]]; then
        usage
    fi

    # Check dependencies before proceeding
    check_dependencies

    # Resolve to absolute path
    if [[ "$DEST_DIR" != /* ]]; then
        DEST_DIR="$(cd "$DEST_DIR" 2>/dev/null && pwd)" || {
            log_error "Destination path does not exist: $1"
            exit 1
        }
    fi

    # Validate destination exists
    if [[ ! -d "$DEST_DIR" ]]; then
        log_error "Destination is not a directory: $DEST_DIR"
        exit 1
    fi

    # Handle uninstall mode
    if [[ "$UNINSTALL_MODE" == "true" ]]; then
        uninstall_lisa
        # uninstall_lisa calls exit, so we never get here
    fi

    echo ""
    echo -e "${BLUE}========================================${NC}"
    if [[ "$VALIDATE_ONLY" == "true" ]]; then
        echo -e "${BLUE}    Lisa Project Bootstrapper (VALIDATE)${NC}"
    elif [[ "$DRY_RUN" == "true" ]]; then
        echo -e "${BLUE}    Lisa Project Bootstrapper (DRY RUN)${NC}"
    else
        echo -e "${BLUE}    Lisa Project Bootstrapper${NC}"
    fi
    echo -e "${BLUE}========================================${NC}"
    echo ""
    if [[ "$VALIDATE_ONLY" == "true" ]]; then
        log_info "Validate mode - checking project compatibility"
    elif [[ "$DRY_RUN" == "true" ]]; then
        log_warn "Dry run mode - no changes will be made"
    fi
    log_info "Lisa directory: $LISA_DIR"
    log_info "Destination:    $DEST_DIR"

    # Initialize backup for atomic transactions (only for actual runs)
    if [[ "$DRY_RUN" == "false" ]]; then
        init_backup
        init_manifest
        trap handle_error EXIT
    fi

    # Detect project types
    detect_project_types

    # Confirm with user
    confirm_project_types

    # Process 'all' directory first
    log_info "Processing common configurations (all/)..."
    process_project_type "all"

    # Process each detected type
    for type in "${DETECTED_TYPES[@]+"${DETECTED_TYPES[@]}"}"; do
        if [[ -d "$LISA_DIR/$type" ]]; then
            log_info "Processing $type configurations..."
            process_project_type "$type"
        else
            log_warn "No configuration directory found for type: $type"
        fi
    done

    # Success - cleanup backup (trap won't trigger rollback)
    if [[ "$DRY_RUN" == "false" ]]; then
        trap - EXIT
        cleanup_backup
    fi

    # Print summary
    print_summary
}

main "$@"

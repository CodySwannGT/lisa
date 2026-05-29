# Rails Coding Conventions

This rule enforces Rails-specific coding standards for consistency, maintainability, and performance.

## Fat Models, Skinny Controllers

Controllers handle HTTP concerns only. Business logic belongs in models or service objects.

```ruby
# Correct — controller delegates to model
class OrdersController < ApplicationController
  def create
    @order = Order.place(order_params, current_user)
    redirect_to @order
  end
end

# Wrong — business logic in controller
class OrdersController < ApplicationController
  def create
    @order = Order.new(order_params)
    @order.user = current_user
    @order.total = @order.line_items.sum(&:price)
    @order.apply_discount(current_user.discount_rate)
    @order.save!
    OrderMailer.confirmation(@order).deliver_later
    redirect_to @order
  end
end
```

## Service Objects

Extract complex business logic into service objects when a model method would be too large or spans multiple models.

```ruby
# app/services/order_placement_service.rb
class OrderPlacementService
  def initialize(user:, params:)
    @user = user
    @params = params
  end

  def call
    order = Order.new(@params)
    order.user = @user
    order.calculate_total
    order.save!
    OrderMailer.confirmation(order).deliver_later
    order
  end
end
```

## Concerns

Use concerns to share behavior across models or controllers. Keep concerns focused on a single responsibility.

```ruby
# app/models/concerns/searchable.rb
module Searchable
  extend ActiveSupport::Concern

  included do
    scope :search, ->(query) { where("name ILIKE ?", "%#{query}%") }
  end
end
```

## ActiveRecord Patterns

### Scopes over class methods for chainable queries

```ruby
# Correct — scope
scope :active, -> { where(active: true) }
scope :recent, -> { order(created_at: :desc) }

# Wrong — class method for simple query
def self.active
  where(active: true)
end
```

### Validations

```ruby
# Use built-in validators
validates :email, presence: true, uniqueness: true, format: { with: URI::MailTo::EMAIL_REGEXP }
validates :age, numericality: { greater_than: 0 }
```

### Callbacks — use sparingly

Prefer explicit service objects over callbacks for complex side effects. Callbacks are acceptable for simple data normalization.

```ruby
# Acceptable — simple normalization
before_validation :normalize_email

private

def normalize_email
  self.email = email&.downcase&.strip
end
```

## N+1 Query Prevention

Always use `includes`, `preload`, or `eager_load` to prevent N+1 queries. The Bullet gem is included to detect these in development.

```ruby
# Correct — eager loading
@posts = Post.includes(:author, :comments).where(published: true)

# Wrong — N+1 query
@posts = Post.where(published: true)
@posts.each { |post| post.author.name } # N+1!
```

## Strong Parameters

Always use strong parameters in controllers. Never use `permit!`.

```ruby
# Correct
def order_params
  params.require(:order).permit(:product_id, :quantity, :notes)
end

# Wrong — permits everything
def order_params
  params.require(:order).permit!
end
```

## Database Migrations

- Use `strong_migrations` gem constraints (included via Gemfile.lisa)
- Never modify `db/schema.rb` directly
- Always add indexes for foreign keys and commonly queried columns
- Use `change` method when the migration is reversible; use `up`/`down` when it is not

```ruby
class AddIndexToOrdersUserId < ActiveRecord::Migration[7.2]
  def change
    add_index :orders, :user_id
  end
end
```

## Testing with RSpec

- Use `let` and `let!` for test setup
- Use `described_class` instead of repeating the class name
- Use `factory_bot` for test data, not fixtures
- Use `shoulda-matchers` for model validation tests
- Keep tests focused — one assertion concept per example

```ruby
RSpec.describe Order, type: :model do
  describe "validations" do
    it { is_expected.to validate_presence_of(:user) }
    it { is_expected.to validate_numericality_of(:total).is_greater_than(0) }
  end

  describe ".recent" do
    it "returns orders in descending creation order" do
      old_order = create(:order, created_at: 1.day.ago)
      new_order = create(:order, created_at: 1.hour.ago)

      expect(described_class.recent).to eq([new_order, old_order])
    end
  end
end
```

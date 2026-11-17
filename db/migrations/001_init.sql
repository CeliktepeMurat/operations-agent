-- Core company data. Money is integer cents (USD).
-- Cross-row rules (refund limits, ownership) are enforced by the permission layer, not here.

CREATE TABLE customers (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      text NOT NULL UNIQUE,
  full_name  text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku         text NOT NULL UNIQUE,
  name        text NOT NULL,
  price_cents bigint NOT NULL CHECK (price_cents > 0)
);

CREATE TABLE orders (
  id          bigint GENERATED ALWAYS AS IDENTITY (START WITH 1001) PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES customers(id),
  status      text NOT NULL CHECK (status IN ('pending', 'paid', 'shipped', 'delivered', 'cancelled')),
  total_cents bigint NOT NULL CHECK (total_cents > 0),

  ship_line1       text NOT NULL,
  ship_city        text NOT NULL,
  ship_postal_code text NOT NULL,
  ship_country     text NOT NULL,

  carrier         text,
  tracking_number text,
  customer_note   text, -- untrusted: customer-written, ends up in model context

  created_at   timestamptz NOT NULL DEFAULT now(),
  shipped_at   timestamptz,
  delivered_at timestamptz
);
CREATE INDEX orders_customer_id_idx ON orders (customer_id);

CREATE TABLE order_items (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id         bigint NOT NULL REFERENCES orders(id),
  product_id       bigint NOT NULL REFERENCES products(id),
  quantity         integer NOT NULL CHECK (quantity > 0),
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents > 0) -- price at purchase time
);
CREATE INDEX order_items_order_id_idx ON order_items (order_id);

CREATE TABLE payments (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id     bigint NOT NULL REFERENCES orders(id),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  status       text NOT NULL CHECK (status IN ('captured', 'failed')),
  provider_ref text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_order_id_idx ON payments (order_id);

CREATE TABLE refunds (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id     bigint NOT NULL REFERENCES orders(id),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  reason       text NOT NULL,
  status       text NOT NULL CHECK (status IN ('completed', 'failed')),
  provider_ref text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refunds_order_id_idx ON refunds (order_id);

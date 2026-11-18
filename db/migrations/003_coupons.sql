-- Fixed-amount coupons issued to a customer (e.g. goodwill after a late delivery).
CREATE TABLE coupons (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code         text NOT NULL UNIQUE,
  customer_id  bigint NOT NULL REFERENCES customers(id),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  reason       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz
);
CREATE INDEX coupons_customer_id_idx ON coupons (customer_id);

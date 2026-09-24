variable "name_prefix" {
  type = string
}

variable "topics" {
  description = <<-EOT
    SNS topic names, one per message type from docs/CONTRACTS.md §10, plus the literal
    "notifications-outbound" topic from §9. Kept as a plain list (not derived from anything
    code-generated) because, per ADR-0004/DECISIONS.md D3, message contracts are intentionally
    NOT a shared assembly — there is no single source of truth to generate this list from, so it
    is hand-maintained here and must be kept in sync with docs/CONTRACTS.md §10 by hand.
  EOT
  type        = list(string)
  default = [
    # Ticketing.Contracts.V1 — owned/published by Ticketing
    "ticketing-contracts-v1-ticketconfirmedv1",
    "ticketing-contracts-v1-ticketconfirmationfailedv1",
    "ticketing-contracts-v1-reservationreleasedv1",

    # Orders.Contracts.V1 — owned/published/sent by Orders
    "orders-contracts-v1-ordersubmittedv1",
    "orders-contracts-v1-orderconfirmedv1",
    "orders-contracts-v1-ordercancelledv1",
    "orders-contracts-v1-processpaymentv1",
    "orders-contracts-v1-confirmseatv1",
    "orders-contracts-v1-releasereservationv1",
    "orders-contracts-v1-refundpaymentv1",

    # Payments.Contracts.V1 — owned/published by Payments
    "payments-contracts-v1-paymentsucceededv1",
    "payments-contracts-v1-paymentfailedv1",
    "payments-contracts-v1-paymentrefundedv1",

    # Notification Service's own outbound stream (docs/CONTRACTS.md §9) — a literal name, not
    # derived from a C# type. No consumer is modeled here (external email/SMS/push system,
    # outside this platform's scope).
    "notifications-outbound",
  ]
}

variable "subscriptions" {
  description = <<-EOT
    One queue per consuming service (matching ARCHITECTURE.md §3/§8's Rel(...) lines and
    docs/CONTRACTS.md's per-service "Consumes:" lists), each subscribed to every topic it needs.
    NOTE (same honesty caveat as infrastructure/k8s/base/localstack/provision-configmap.yaml):
    the exact topic names MassTransit derives at runtime depend on building-blocks/messaging
    configuration that is still being written elsewhere as of writing — this mapping is a
    reasonable, but unverified, best guess. Confirm against MassTransit's actual startup log
    before relying on this for anything beyond a structural skeleton.
  EOT
  type = map(object({
    topics = list(string)
  }))
  default = {
    orders-service = {
      topics = [
        "orders-contracts-v1-ordersubmittedv1", # Orders self-consumes to start the saga (DECISIONS.md D7)
        "payments-contracts-v1-paymentsucceededv1",
        "payments-contracts-v1-paymentfailedv1",
        "ticketing-contracts-v1-ticketconfirmedv1",
        "ticketing-contracts-v1-ticketconfirmationfailedv1", # Confirming -> Cancelling compensation edge (DECISIONS.md D8)
        "ticketing-contracts-v1-reservationreleasedv1",
      ]
    }
    payments-service = {
      topics = [
        "orders-contracts-v1-processpaymentv1",
        "orders-contracts-v1-refundpaymentv1",
      ]
    }
    ticketing-service = {
      topics = [
        "orders-contracts-v1-confirmseatv1",
        "orders-contracts-v1-releasereservationv1",
      ]
    }
    notification-service = {
      topics = [
        "orders-contracts-v1-orderconfirmedv1",
        "payments-contracts-v1-paymentsucceededv1",
        "payments-contracts-v1-paymentfailedv1",
        "ticketing-contracts-v1-ticketconfirmedv1",
      ]
    }
  }
}

variable "max_receive_count" {
  description = "Deliveries attempted before a message is moved to its queue's DLQ (poison-message handling, per the prompt's messaging requirements)."
  type        = number
  default     = 5
}

variable "tags" {
  type    = map(string)
  default = {}
}

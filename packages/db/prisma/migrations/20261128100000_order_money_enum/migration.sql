-- Marketplace M3-3 «Soldi e squadra» (ADR-088): il rimborso fra i tipi di pagamento di un ordine.
-- Postgres non usa un valore nuovo di un enum nella transazione che lo aggiunge: il CHECK che lo
-- usa sta nella migrazione dopo (`order_money`).
ALTER TYPE "OrderPaymentKind" ADD VALUE 'REFUND';

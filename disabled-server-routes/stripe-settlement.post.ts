import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

/**
 * Stripe Settlement Webhook Handler
 * POST /api/public/hooks/stripe-settlement
 * 
 * Processes incoming Stripe payment events (checkout.session.completed, payment_intent.succeeded).
 * Verifies webhook signature using STRIPE_WEBHOOK_SECRET.
 * Updates asset status to "escrow_locked" in Supabase on successful payment.
 */

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16',
});

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default defineEventHandler(async (event) => {
  try {
    // Get raw body for signature verification
    const body = await readRawBody(event);
    
    if (!body) {
      return sendError(event, createError({
        statusCode: 400,
        statusMessage: 'Missing request body',
      }));
    }

    const signature = getHeader(event, 'stripe-signature');
    
    if (!signature) {
      console.warn('[Stripe Webhook] Missing stripe-signature header');
      return sendError(event, createError({
        statusCode: 400,
        statusMessage: 'Missing stripe-signature header',
      }));
    }

    // Verify webhook signature
    let stripeEvent;
    try {
      stripeEvent = stripe.webhooks.constructEvent(
        body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET || ''
      );
    } catch (err: any) {
      console.error('[Stripe Webhook] Signature verification failed:', err.message);
      return sendError(event, createError({
        statusCode: 400,
        statusMessage: `Webhook signature verification failed: ${err.message}`,
      }));
    }

    console.log(`[Stripe Webhook] Event ID: ${stripeEvent.id}, Type: ${stripeEvent.type}`);

    // Handle key payment events
    if (stripeEvent.type === 'checkout.session.completed') {
      const session = stripeEvent.data.object as any;
      const metadata = session.metadata || {};
      const parcelId = metadata.parcel_id;
      const buyerId = metadata.buyer_id;
      const depositAmount = metadata.deposit_amount;

      if (!parcelId || !buyerId) {
        console.warn(`[Stripe Webhook] Missing parcel_id or buyer_id in metadata`, { parcelId, buyerId });
        return { received: true };
      }

      console.log(`[Stripe Webhook] Processing checkout session: parcelId=${parcelId}, buyerId=${buyerId}`);

      // Update asset status to escrow_locked in Supabase
      const { error: updateError } = await supabase
        .from('assets')
        .update({
          status: 'escrow_locked',
          escrow_deposit_amount: depositAmount,
          updated_at: new Date().toISOString(),
        })
        .eq('id', parcelId);

      if (updateError) {
        console.error(`[Stripe Webhook] Supabase update failed: ${updateError.message}`, { parcelId });
        // Still return 200 to prevent Stripe retry, but log the error
        return { received: true };
      }

      console.log(`[Stripe Webhook] Asset updated successfully: parcelId=${parcelId}, status=escrow_locked`);
    }

    if (stripeEvent.type === 'payment_intent.succeeded') {
      const paymentIntent = stripeEvent.data.object as any;
      const metadata = paymentIntent.metadata || {};
      const parcelId = metadata.parcel_id;

      if (parcelId) {
        console.log(`[Stripe Webhook] Payment intent succeeded: parcelId=${parcelId}`);
        // Additional payment success handling can be added here
      }
    }

    return { received: true };
  } catch (err: any) {
    console.error('[Stripe Webhook] Unexpected error:', err);
    return sendError(event, createError({
      statusCode: 500,
      statusMessage: 'Internal server error',
    }));
  }
});
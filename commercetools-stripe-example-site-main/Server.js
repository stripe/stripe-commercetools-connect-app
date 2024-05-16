import express from "express";
import { fileURLToPath } from "url";
import path from "path";
import { dirname } from "path";
import cors from "cors";
import dotenv from "dotenv";

import commerceTools from "./CommerceToolsHelper.js";
import Stripe from "stripe";
import { version } from "os";

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.use(express.static(path.join(__dirname, "client/build")));
app.use("/confirm", express.static(path.join(__dirname, "client/build")));
app.use(cors());

dotenv.config();

const STRIPE_KEY = process.env.REACT_APP_SK;
const STRIPE_ADMIN = process.env.REACT_APP_ADMIN;
const PORT = process.env.REACT_APP_PORT;
const BASE_URL = process.env.REACT_APP_BASE_URL;

const stripe = new Stripe(STRIPE_KEY);

/* ------ SETUP WEBHOOK ON START------ */
const WEBHOOK_URL = BASE_URL + "/events";
const WEBHOOK_EVENTS = [
  "payment_intent.payment_failed",
  "payment_intent.succeeded",
  "charge.refunded",
  "charge.dispute.created",
];
const webhookEndpoints = await stripe.webhookEndpoints.list();
const existingWebhook = webhookEndpoints.data.find(
  ({ url }) => url === WEBHOOK_URL
);
if (existingWebhook) {
  //Add any missing events if webhook created
  await stripe.webhookEndpoints.update(existingWebhook.id, {
    enabled_events: WEBHOOK_EVENTS,
  });
  console.log("Existing Webhook Found!");
} else {
  try {
    //Create new webhook if none found
    const webhookEndpoint = await stripe.webhookEndpoints.create({
      url: WEBHOOK_URL,
      enabled_events: WEBHOOK_EVENTS,
    });
    if (webhookEndpoint) {
      console.log("Created Webhook!");
    }
  } catch (e) {
    console.log("ERROR creating webhook: " + e.message);
    console.log(
      'NOTE: If your REACT_APP_BASE_URL is a local address you may receive a "URL must be publicly accessible" error, this is expected. Please refer to the Testing Webhooks section in the README.md'
    );
  }
}

/* ------ BUSINESS MODEL ------ */
app.get("/settings", async (req, res) => {
  const account = await stripe.accounts.retrieve(STRIPE_ADMIN);
  let icon = false;
  if (account.settings.branding.logo) {
    const iconFile = await stripe.files.retrieve(
      account.settings.branding.icon
    );
    icon = iconFile.links.data[0].url || false;
  }

  res.send({
    shop_name: account.settings.dashboard.display_name,
    icon: icon,
    primary_color: account.settings.branding.primary_color,
  });
});

app.get("/products/:currency", async (req, res) => {
  const currency = req.params.currency;
  const ctProducts = await commerceTools.getProducts();
  res.send(ctProducts.results);
});

/* ------ GET CUSTOMER BY EMAIL ------ */
app.get("/customer/:email?", async (req, res) => {
  const customers = await commerceTools.getCustomerByEmail(req.params.email);
  if (req.params.email === undefined || customers.total === 0)
    res.send({
      id: "",
      name: "",
      address: "",
      city: "",
      country: "",
    });
  else {
    res.send({
      id: customers.results[0].id,
      name: `${customers.results[0].firstName} ${customers.results[0].lastName}`,
      addressId: customers.results[0].addresses[0].id,
      address: `${customers.results[0].addresses[0].streetName}`,
      city: customers.results[0].addresses[0].city,
      country: customers.results[0].addresses[0].country,
    });
  }
});

/* ------ GET CART------ */
app.get("/cart/:cartId?", async (req, res) => {
  res.send(await commerceTools.getCart(req.params.cartId));
});

/* ------ CREATE CART ------ */
app.post("/cart", async (req, res) => {
  res.send(await commerceTools.createCart());
});

/* ------ ADD CART LINE ITEM ------ */
app.post("/cart/line-item", async (req, res) => {
  const cartId = req.body.cartId;
  const productId = req.body.productId;
  const variantId = req.body.variantId;
  const version = req.body.version;
  res.send(
    await commerceTools.cartAddLineItem(cartId, productId, variantId, version)
  );
});

/* ------ ADD CUSTOMER TO CART------ */
app.post("/cart/customer", async (req, res) => {
  const cartId = req.body.cartId;
  const customerId = req.body.customerId;
  res.send(await commerceTools.cartAddCustomer(cartId, customerId));
});

/* ------ CREATE CUSTOMER ------ */
app.post("/customer", async (req, res) => {

  const payload = {
    email: req.body.email,
    name: req.body.name,
    address: {
      line1: req.body.address,
      city: req.body.city,
      country: req.body.country,
    },
    shipping: {
      name: req.body.name,
      address: {
        line1: req.body.address,
        city: req.body.city,
        country: req.body.country,
      },
    }
  };
  let stripeCustomer = await stripe.customers.create(payload);
  payload.cartId = req.body.cartId;
  res.send(await commerceTools.createCustomer(payload, stripeCustomer.id));
});

/* ------ HOSTED CHECKOUT ------ */
app.post("/create-checkout-session", async (req, res) => {

  const cart = req.body.cart;
  const ctCustomerId = req.body.customer;
  const ctCustomer = await commerceTools.getCustomer(ctCustomerId);
  const currency = req.body.currency;
  const items = [];
  let summary = "";
  const order = await commerceTools.createOrder(cart, "Open");

  cart.lineItems.forEach((item) => {
    const price = item.price.value.centAmount;
    items.push({
      price_data: {
        currency: currency,
        unit_amount: price,
        product_data: {
          name: item.name["en-US"],
          images: [item.variant.images[0].url],
        },
      },
      quantity: 1,
    });
    summary += item.id + "  [" + item.name["en-US"] + "] ";
  });

  try {
    const payload = {
      mode: "payment",
      customer: ctCustomer.externalId,
      line_items: items,
      success_url: BASE_URL + "/confirm?checkout_session={CHECKOUT_SESSION_ID}",
      cancel_url: BASE_URL,
      metadata: { summary: summary },
      payment_intent_data:{
        metadata:{
          summary: summary,
          commerceToolsCartId: cart.id,
          commerceToolsOrderId: order.id,
        }
      },
      shipping_address_collection: {
        allowed_countries: [],
      },
      customer_update: {
        shipping: "auto",
      },
    };
    if (currency === "usd") {
      payload.payment_method_types = ["card", "afterpay_clearpay"];
      payload.shipping_address_collection.allowed_countries = ["US"];
    }
    if (currency === "eur") {
      payload.payment_method_types = ["card", "sofort", "giropay"];
      payload.shipping_address_collection.allowed_countries = [
        "FR",
        "NL",
        "GB",
        "DE",
      ];
    }
    if (currency === "gbp") {
      payload.payment_method_types = ["card", "bacs_debit"];
      payload.payment_intent_data.setup_future_usage = "off_session";
      payload.shipping_address_collection.allowed_countries = ["GB"];
    }

    //need to use old api version as the new one doesn't create payment intent when creating checkout session.
    //https://stripe.com/docs/upgrades#2022-08-01

    const stripe2020 = new Stripe(STRIPE_KEY, {apiVersion: '2020-08-27'});

    const session = await stripe2020.checkout.sessions.create(payload);

    // Copy metadata to PI
    const pi = await stripe.paymentIntents.retrieve(session.payment_intent)

    const payment = await commerceTools.createPayment(pi, currency, pi.amount);
    commerceTools.updatePaymentState("Authorization", pi);
    await commerceTools.addPaymentToOrder(order.id, payment);


    res.send({
      sessionId: session.id,
      url: session.url
    });

  } catch (e) {
    res.status(400);
    return res.send({
      error: {
        message: e.message,
      },
    });
  }
});

// Retrieving a session or a PI to display details on redirect from hosted checkout or from UPE
app.get("/session/:id", async (req, res) => {

  const id = req.params.id;
  let pi;

  if (id.indexOf("cs_") > -1) {
    const session = await stripe.checkout.sessions.retrieve(id);
    pi = await stripe.paymentIntents.retrieve(session.payment_intent);
  } else {
    pi = await stripe.paymentIntents.retrieve(id);
  }


  res.send({
    receipt: pi.id,
    //email: pi.charges.data[0].billing_details.email
  });
});

/* ------ ELEMENTS AND UPE ------ */
app.post("/create-payment-intent", async (req, res) => {
  const cart = req.body.cart;
  const ctCustomerId = req.body.customer;
  const ctCustomer = await commerceTools.getCustomer(ctCustomerId);
  const currency = req.body.currency;
  const order = await commerceTools.createOrder(cart, "Open");

  let total = cart.totalPrice.centAmount;
  let summary = "";
  cart.lineItems.forEach((item) => {
    const price = item.price.value.centAmount;
    summary += item.id + "  [" + item.name["en-US"] + "] ";
  });

  const payload = {
    amount: total,
    currency: currency,
    metadata: {
      summary: summary,
      commerceToolsCartId: cart.id,
      commerceToolsOrderId: order.id,
    },
    capture_method: "automatic",
    customer: ctCustomer.externalId,
  };

  if (currency === "usd") {
    payload.payment_method_types = ["card", "afterpay_clearpay"];
  }
  if (currency === "eur") {
    payload.payment_method_types = ["card", "sofort", "giropay"];
  }
  if (currency === "gbp") {
    payload.payment_method_types = ["card", "bacs_debit"];
  }

  const paymentIntent = await stripe.paymentIntents.create(payload);

  const payment = await commerceTools.createPayment(
    paymentIntent,
    currency,
    total
  );
  commerceTools.updatePaymentState("Authorization", paymentIntent);

  await commerceTools.addPaymentToOrder(order.id, payment);

  res.send({
    clientSecret: paymentIntent.client_secret,
  });
});

/* ------ WEBHOOK ENDPOINT ------ */
app.post("/events", async (req, res) => {

  // console.log('====================================');
  // console.log('webhook event : ', req.body.type);
  // console.log('====================================');



  if (req.body.type == "payment_intent.succeeded") {

    const paymentIntent = await stripe.paymentIntents.retrieve(
      req.body.data.object.id
    );
    const orderstatus = await commerceTools.updateOrder(
      paymentIntent.metadata.commerceToolsOrderId,
      "Paid",
      paymentIntent
    );
    
    const paymentstatus = await commerceTools.updatePaymentState("Charge", paymentIntent);

  }

  if (req.body.type == "payment_intent.payment_failed") {
    const paymentIntent = await stripe.paymentIntents.retrieve(
      req.body.data.object.id
    );
    commerceTools.updateOrder(
      paymentIntent.metadata.commerceToolsOrderId,
      "Failed",
      paymentIntent
    );
    commerceTools.updatePaymentState("CancelAuthorization", paymentIntent);
  }
  if (req.body.type == "charge.refunded") {
    const paymentIntent = await stripe.paymentIntents.retrieve(
      req.body.data.object.payment_intent
    );
    paymentIntent.amount = req.body.data.object.amount_refunded;
    commerceTools.updatePaymentState("Refund", paymentIntent);
  }
  if (req.body.type == "charge.dispute.created") {
    const paymentIntent = await stripe.paymentIntents.retrieve(
      req.body.data.object.payment_intent
    );
    commerceTools.updatePaymentState("Chargeback", paymentIntent);
  }
  res.sendStatus(200);
});

app.listen(PORT);

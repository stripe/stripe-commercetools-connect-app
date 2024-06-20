import React from "react";
import { loadStripe } from "@stripe/stripe-js";

export default function CheckoutHosted(props) {
  const styles = {
    button: {
      color: "white",
      backgroundColor: props.brandColor,
      border: 0,
    },
  };

  const goCheckout = async (e) => {
    e.preventDefault();
    const stripe = await loadStripe(process.env.REACT_APP_PK);
    const response = await fetch("/create-checkout-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cart: props.cart,
        customer: props.custId,
        currency: props.currency,
      }),
    });
    const session = await response.json();


    const result = await stripe.redirectToCheckout({
      sessionId: session.sessionId,
    });
  };

  return (
    <button
      className="form-control btn btn-primary"
      style={styles.button}
      onClick={goCheckout}
    >
      Checkout
    </button>
  );
}

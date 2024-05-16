// Modules
import React, { useState } from "react";
import { BrowserRouter, Route, Switch } from "react-router-dom";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import Header from "./components/Header";
import ProductList from "./components/ProductList";
import Checkout from "./components/Checkout";
import Confirmation from "./components/Confirmation";
import "./styles/index.css";

const promise = loadStripe(process.env.REACT_APP_PK);

export default function App() {
  const [cart, setCart] = useState();
  const [brandColor, setBrandColor] = useState("#425466");
  const [currency, setCurrency] = useState("eur");

  const addToCart = async (obj) => {
    if (!cart) {
      fetch("/cart", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      })
        .then((res) => res.json())
        .then((data) => {
          setCart(data);
          updateCart(data.id, obj.id, null, 1);
        });
    } else {
      updateCart(
        cart.id,
        obj.id,
        obj.masterData.current.masterVariant.id,
        cart.version
      );
    }
  };

  const updateCart = async (cartId, productId, variantId, version) => {
    fetch("/cart/line-item", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cartId: cartId,
        productId: productId,
        variantId: variantId,
        version: version,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        setCart(data);
      });
  };

  const resetCart = () => {
    setCart();
  };

  const pickCurrency = (e) => {
    setCurrency(e.target.value);
  };

  return (
    <BrowserRouter>
      <Switch>
        <Route path="/checkout">
          <Header
            cart={cart}
            resetCart={resetCart}
            brandColor={brandColor}
            setBrandColor={setBrandColor}
            currency={currency}
            pickCurrency={pickCurrency}
            showCart={false}
          />
          <Elements stripe={promise}>
            <Checkout
              cart={cart}
              brandColor={brandColor}
              currency={currency}
              setCart={setCart}
            />
          </Elements>
        </Route>
        <Route path="/confirm/:id">
          <Header
            cart={cart}
            resetCart={resetCart}
            brandColor={brandColor}
            setBrandColor={setBrandColor}
            currency={currency}
            pickCurrency={pickCurrency}
            showCart={false}
          />
          <Confirmation />
        </Route>
        <Route path="/confirm">
          <Header
            cart={cart}
            resetCart={resetCart}
            brandColor={brandColor}
            setBrandColor={setBrandColor}
            currency={currency}
            pickCurrency={pickCurrency}
            showCart={false}
          />
          <Confirmation />
        </Route>
        <Route path="/">
          <Header
            cart={cart}
            resetCart={resetCart}
            brandColor={brandColor}
            setBrandColor={setBrandColor}
            currency={currency}
            pickCurrency={pickCurrency}
            showCart={true}
          />
          <ProductList
            addToCart={addToCart}
            brandColor={brandColor}
            currency={currency}
          />
        </Route>
      </Switch>
    </BrowserRouter>
  );
}

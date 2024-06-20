import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";

export default function Confirmation(props) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [id, setID] = useState();
  const [pm, setPM] = useState();

  const styles = {
    receipt: {
      display: "inline",
      fontWeight: 600,
    },
    summary: {
      padding: 15,
    },
  };

  const query = new URLSearchParams(useLocation().search);
 

  useEffect(() => {
    setID(query.get("payment_intent") || query.get("checkout_session"));
  }, []);


  useEffect(() => {
    if (id) {
      fetch("/session/" + id)
        .then((res) => res.json())
        .then((obj) => {
          setPM(obj.receipt);
          setIsLoaded(true);
        });
    }
  }, [id]);

  if (isLoaded) {
    return (
      <div className="row">
        <div className="col">
          <div className="card w-100" style={styles.summary}>
            <div>
              Thank you your purchase. Your receipt ID is{" "}
              <span style={styles.receipt}>{pm}</span>.
            </div>
          </div>
        </div>
      </div>
    );
  } else {
    return "";
  }
}

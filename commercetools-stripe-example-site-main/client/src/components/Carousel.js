import React from "react";

export default function Carousel(props) {
  const styles = {
    img: {
      maxHeight: 500,
      objectFit: "cover",
      marginLeft: "auto",
      marginRight: "auto",
      borderRadius: 5,
    },
  };

  return (
    <div
      id={"carousel_" + props.id}
      className="carousel slide carousel-fade"
      data-bs-ride="carousel"
    >
      <div className="carousel-inner">
        {props.images.map((img, key) => (
          <div
            className={key === 0 ? "carousel-item active" : "carousel-item"}
            key={key}
          >
            <img
              src={img}
              style={styles.img}
              className="d-block w-100"
              alt={props.name}
            />
          </div>
        ))}
      </div>
      {props.images.length > 1 && (
        <>
          <button
            className="carousel-control-prev"
            type="button"
            data-bs-target={"#carousel_" + props.id}
            data-bs-slide="prev"
          >
            <span
              className="carousel-control-prev-icon"
              aria-hidden="true"
            ></span>
            <span className="visually-hidden">Previous</span>
          </button>
          <button
            className="carousel-control-next"
            type="button"
            data-bs-target={"#carousel_" + props.id}
            data-bs-slide="next"
          >
            <span
              className="carousel-control-next-icon"
              aria-hidden="true"
            ></span>
            <span className="visually-hidden">Next</span>
          </button>
        </>
      )}
    </div>
  );
}

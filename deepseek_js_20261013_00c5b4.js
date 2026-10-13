    if (imgSrc) {
      var img = document.createElement("img");
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = String(product.name || "Product");

      // Multi-size support: derive variant URLs from the primary URL
      if (window.MultiSizeUploader && window.MultiSizeUploader.buildSrcsetFor) {
        var srcset = window.MultiSizeUploader.buildSrcsetFor(imgSrc);
        if (srcset) {
          img.srcset = srcset;
          img.sizes = "(max-width: 400px) 400px, (max-width: 800px) 800px, 1200px";
        }
      }

      img.addEventListener("error", function () {
        if (img.parentNode === imageWrap) {
          imageWrap.removeChild(img);
          imageWrap.appendChild(buildImagePlaceholder());
        }
      }, { once: true });
      img.src = imgSrc;
      imageWrap.appendChild(img);
    }
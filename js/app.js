function preciosPizarra() {
  return {
    cargando: true,
    error: null,
    diaPizarra: '',
    leyenda: '',
    productos: [],

    // PLACEHOLDER - se reemplaza automáticamente en el deploy
    API_URL: '{{API_URL}}',

    iconosUrls: {
      'TRIGO': 'img/products/trigo.png',
      'MAÍZ': 'img/products/maiz.png',
      'GIRASOL': 'img/products/girasol.png',
      'SOJA': 'img/products/soja.png',
      'SORGO': 'img/products/sorgo.png'
    },

    async init() {
      await this.cargarDatos();
    },

    cargarDatos() {
      this.cargando = true;
      this.error = null;

      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        const callbackName = 'cacCallback_' + Date.now();

        const timeout = setTimeout(() => {
          cleanup();
          this.error = 'Timeout al cargar datos';
          this.cargando = false;
          reject();
        }, 15000);

        const cleanup = () => {
          clearTimeout(timeout);
          if (script.parentNode) script.parentNode.removeChild(script);
          delete window[callbackName];
        };

        window[callbackName] = (datos) => {
          cleanup();

          if (datos.error) {
            this.error = datos.message || 'Error del servidor';
            this.productos = [];
          } else {
            this.diaPizarra = datos.diaPizarra || '';
            this.leyenda = datos.leyenda || '';
            this.productos = datos.productos || [];
          }
          this.cargando = false;
          resolve();
        };

        script.onerror = () => {
          cleanup();
          this.error = 'Error de conexión con el servidor';
          this.cargando = false;
          reject();
        };

        script.src = `${this.API_URL}?callback=${callbackName}&t=${Date.now()}`;
        document.head.appendChild(script);
      });
    },

    getIconoUrl(nombre) {
      return this.iconosUrls[nombre] || '';
    },

    formatearPrecio(valor) {
      if (valor === null || valor === undefined) return '$---';
      return '$' + valor.toLocaleString('es-AR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    },

    formatearDiferencia(valor, tendencia) {
      if (valor === null || valor === undefined) return '-';

      if (tendencia === 'baja' && valor > 0) {
        return '-' + valor.toLocaleString('es-AR', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0
        });
      }

      if (tendencia === 'sube' && valor > 0) {
        return '+' + valor.toLocaleString('es-AR', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0
        });
      }

      return valor.toLocaleString('es-AR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });
    },

    getBorderLeftColor(nombre) {
      const colores = {
        'TRIGO': 'border-yellow-500',
        'MAÍZ': 'border-yellow-600',
        'GIRASOL': 'border-yellow-400',
        'SOJA': 'border-green-600',
        'SORGO': 'border-red-700'
      };
      return colores[nombre] || 'border-gray-500';
    },

    getDiffColor(tendencia) {
      if (tendencia === 'sube') return 'text-green-600';
      if (tendencia === 'baja') return 'text-red-600';
      return 'text-gray-500';
    }
  }
}
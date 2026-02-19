/**
 * Servidor de Precios CAC - Google Apps Script
 */

const CONFIG = {
  URL_CAC: 'https://www.cac.bcr.com.ar/es/precios-de-pizarra',
  CACHE_DURATION: 300
};

function doGet(e) {
  try {
    const cache = CacheService.getScriptCache();
    const cached = cache.get('precios_cac');
    let datos;
    
    if (cached) {
      datos = JSON.parse(cached);
    } else {
      datos = scrapearPreciosCAC();
      cache.put('precios_cac', JSON.stringify(datos), CONFIG.CACHE_DURATION);
    }
    
    if (e.parameter.callback) {
      const output = ContentService.createTextOutput(
        e.parameter.callback + '(' + JSON.stringify(datos) + ');'
      );
      output.setMimeType(ContentService.MimeType.JAVASCRIPT);
      return output;
    }
    
    const output = ContentService.createTextOutput(JSON.stringify(datos));
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
      
  } catch (error) {
    const errorResponse = {
      error: true,
      message: error.toString(),
      diaPizarra: '',
      leyenda: '',
      productos: []
    };
    
    if (e.parameter.callback) {
      const output = ContentService.createTextOutput(
        e.parameter.callback + '(' + JSON.stringify(errorResponse) + ');'
      );
      output.setMimeType(ContentService.MimeType.JAVASCRIPT);
      return output;
    }
    
    const output = ContentService.createTextOutput(JSON.stringify(errorResponse));
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
  }
}

function scrapearPreciosCAC() {
  const response = UrlFetchApp.fetch(CONFIG.URL_CAC, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    throw new Error('Error HTTP: ' + response.getResponseCode());
  }

  const html = response.getContentText();
  return extraerDatosDeHTML(html);
}

function extraerDatosDeHTMLold(html) {
  const resultado = {
    diaPizarra: '',
    leyenda: '',
    productos: []
  };

  // 1. EXTRAER "Precios Pizarra del día dd/mm/yyyy"
  const regexDia = /Precios Pizarra del día (\d{2}\/\d{2}\/\d{4})/i;
  const matchDia = html.match(regexDia);
  if (matchDia) {
    resultado.diaPizarra = 'Día ' + matchDia[1];
  }

  // 2. EXTRAER LEYENDA - Buscando el texto directamente
  // Buscar desde "Precios corrientes" hasta que termine el div o párrafo
  const regexLeyenda = /Precios corrientes expresados en \$\/Tn[\s\S]{0,500}hasta las \d{2}:\d{2} hs\./i;
  const matchLeyenda = html.match(regexLeyenda);
  
  if (matchLeyenda) {
    resultado.leyenda = matchLeyenda[0]
      .replace(/<[^>]+>/g, ' ')  // Eliminar tags HTML
      .replace(/&nbsp;/g, ' ')    // Reemplazar &nbsp;
      .replace(/\s+/g, ' ')       // Normalizar espacios
      .trim();
    Logger.log('Leyenda encontrada: ' + resultado.leyenda);
  } else {
    // Fallback: buscar cualquier texto que contenga "Precios corrientes"
    const idx = html.indexOf('Precios corrientes');
    if (idx > -1) {
      const trozo = html.substring(idx, idx + 500);
      Logger.log('Trozo leyenda encontrado: ' + trozo);
      
      // Limpiar y usar
      resultado.leyenda = trozo
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }

  // 3. EXTRAER PRODUCTOS
  const productosMap = {
    'trigo': 'TRIGO',
    'maiz': 'MAÍZ',
    'girasol': 'GIRASOL',
    'soja': 'SOJA',
    'sorgo': 'SORGO'
  };

  for (const [tipo, nombre] of Object.entries(productosMap)) {
    // Regex que permite espacios y comillas después del tipo
    const regexBoard = new RegExp(
      `board-${tipo}[\\s\\S]{0,4000}?<\\/div>\\s*<\\/div>\\s*<\\/div>`,
      'i'
    );
    
    const match = html.match(regexBoard);
    
    if (match) {
      const contenido = match[0];
      
      // Buscar S/C
      const tieneSC = contenido.includes('S/C');
      
      // Buscar precio estimativo: (Estimativo) $XXX.XXX,XX
      const matchEstimativo = contenido.match(/\(Estimativo\)\s*\$([\d\.,]+)/i);
      
      // Buscar precio normal: $XXX.XXX,XX (pero no el de "Estimativo")
      // Tomamos el último $ que no sea precedido por "Estimativo)"
      const precios = contenido.match(/\$([\d\.,]+)/g);
      let precioNormal = null;
      if (precios && precios.length > 0) {
        // Si hay estimativo, tomamos el último precio (que es el estimado)
        // Si no hay estimativo, tomamos el primero (que es el real)
        const ultimo = precios[precios.length - 1];
        precioNormal = ultimo.replace('$', '');
      }
      
      let precio = 0;
      let esEstimativo = false;
      let sinCotizacion = false;
      
      if (tieneSC && matchEstimativo) {
        // Caso: S/C con precio estimado (Sorgo)
        precio = convertirNumero(matchEstimativo[1]);
        esEstimativo = true;
        sinCotizacion = true;
      } else if (precioNormal) {
        // Caso: Precio normal
        precio = convertirNumero(precioNormal);
      }
      
      // Extraer diferencias - buscar números en celdas
      const celdas = contenido.match(/<div class="cell">(-?[\d\.,]+)<\/div>/g) || [];
      const valores = celdas.map(c => {
        const m = c.match(/>(-?[\d\.,]+)</);
        return m ? convertirNumero(m[1]) : 0;
      });
      
      // Tendencia
      let tendencia = 'igual';
      if (contenido.includes('fa-arrow-up')) tendencia = 'sube';
      else if (contenido.includes('fa-arrow-down')) tendencia = 'baja';
      else if (contenido.includes('fa-equals') || contenido.includes('nofont')) tendencia = 'igual';
      
      resultado.productos.push({
        nombre: nombre,
        precio: precio,
        sinCotizacion: sinCotizacion,
        esEstimativo: esEstimativo,
        diferenciaPesos: valores[0] || 0,
        diferenciaPorcentaje: valores[1] || 0,
        tendencia: tendencia,
        moneda: 'ARS',
        unidad: '$/Tn'
      });
    }
  }

  return resultado;
}

function extraerDatosDeHTML(html) {
  const resultado = {
    diaPizarra: '',
    leyenda: '',
    productos: []
  };

  // 1. EXTRAER "Precios Pizarra del día dd/mm/yyyy"
  const regexDia = /Precios Pizarra del día (\d{2}\/\d{2}\/\d{4})/i;
  const matchDia = html.match(regexDia);
  if (matchDia) {
    resultado.diaPizarra = 'Día ' + matchDia[1];
  }

  // 2. EXTRAER LEYENDA - Cortar justo después de "hs."
  const inicioLeyenda = html.indexOf('Precios corrientes expresados');
  if (inicioLeyenda > -1) {
    // Buscar el final: "</b>" después de "hs."
    const finLeyenda = html.indexOf('</b>', inicioLeyenda);
    if (finLeyenda > -1) {
      const textoLeyenda = html.substring(inicioLeyenda, finLeyenda + 4); // +4 para incluir </b>
      resultado.leyenda = textoLeyenda
        .replace(/<[^>]+>/g, ' ')  // Eliminar tags HTML
        .replace(/&nbsp;/g, ' ')    // Reemplazar &nbsp;
        .replace(/\s+/g, ' ')       // Normalizar espacios
        .trim();
      
      // Limpiar el </b> final si quedó
      resultado.leyenda = resultado.leyenda.replace(/\s*<\/b>\s*$/, '');
    }
  }

  // 3. EXTRAER PRODUCTOS
  const productosMap = {
    'trigo': 'TRIGO',
    'maiz': 'MAÍZ',
    'girasol': 'GIRASOL',
    'soja': 'SOJA',
    'sorgo': 'SORGO'
  };

  for (const [tipo, nombre] of Object.entries(productosMap)) {
    const regexBoard = new RegExp(
      `board-${tipo}[\\s\\S]{0,4000}?<\\/div>\\s*<\\/div>\\s*<\\/div>`,
      'i'
    );
    
    const match = html.match(regexBoard);
    
    if (match) {
      const contenido = match[0];
      
      const tieneSC = contenido.includes('S/C');
      const matchEstimativo = contenido.match(/\(Estimativo\)\s*\$([\d\.,]+)/i);
      const precios = contenido.match(/\$([\d\.,]+)/g);
      
      let precio = 0;
      let esEstimativo = false;
      let sinCotizacion = false;
      
      if (tieneSC && matchEstimativo) {
        precio = convertirNumero(matchEstimativo[1]);
        esEstimativo = true;
        sinCotizacion = true;
      } else if (precios && precios.length > 0) {
        const ultimo = precios[precios.length - 1];
        precio = convertirNumero(ultimo.replace('$', ''));
      }
      
      const celdas = contenido.match(/<div class="cell">(-?[\d\.,]+)<\/div>/g) || [];
      const valores = celdas.map(c => {
        const m = c.match(/>(-?[\d\.,]+)</);
        return m ? convertirNumero(m[1]) : 0;
      });
      
      let tendencia = 'igual';
      if (contenido.includes('fa-arrow-up')) tendencia = 'sube';
      else if (contenido.includes('fa-arrow-down')) tendencia = 'baja';
      
      resultado.productos.push({
        nombre: nombre,
        precio: precio,
        sinCotizacion: sinCotizacion,
        esEstimativo: esEstimativo,
        diferenciaPesos: valores[0] || 0,
        diferenciaPorcentaje: valores[1] || 0,
        tendencia: tendencia,
        moneda: 'ARS',
        unidad: '$/Tn'
      });
    }
  }

  return resultado;
}

function convertirNumero(texto) {
  if (!texto) return 0;
  const limpio = texto.toString().replace(/\./g, '').replace(/,/g, '.');
  return parseFloat(limpio) || 0;
}

function testScraping() {
  const resultado = scrapearPreciosCAC();
  Logger.log('RESULTADO:');
  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

function limpiarCache() {
  CacheService.getScriptCache().remove('precios_cac');
  Logger.log('Caché limpiada');
}
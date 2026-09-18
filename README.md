# MiBotTraderV2.1 — laboratorio BTC

Este laboratorio parte del `index.html` público de MiBotTraderV2. La página sigue siendo una cuenta ficticia. El laboratorio histórico está en `lab/` y `scripts/` y no envía órdenes.

## Qué se implementó

- La página simula solo BTCUSDT perpetual. Cambió a los endpoints públicos de futuros de Binance, corrigió una rama inalcanzable de la cascada y exige una señal nueva antes de reabrir.
- V2.1 inicia una cuenta ficticia nueva en el navegador para no mezclar operaciones de reglas distintas; las claves locales anteriores siguen guardadas y no se borran.
- El laboratorio descarga velas de un minuto y eventos de funding de BTCUSDT USD-M perpetual. Rechaza huecos u OHLC inválidos.
- Reconstruye los marcos 1m, 3m, 5m, 15m, 1h, 4h y 1d solo con velas ya cerradas. Las entradas se llenan al minuto siguiente. TP y SL que coinciden en un minuto se resuelven a favor del SL.
- Simula margen de 100 USDT, 10x, costos de entrada y salida, deslizamiento configurable y funding histórico. Los costos por defecto son **supuestos de escenario**, no las tarifas de una cuenta Binance concreta.
- La página y el backtester ahora importan `lab/signals.mjs`: una única implementación de indicadores y señales. La página usa velas nativas cerradas de Binance; el histórico reconstruye esos marcos desde velas de un minuto.
- El preset V2.1 exige DMI direccional en principal y Multi-TF y, para la entrada 1m, tendencia EMA10/55 alineada en 3m y 5m. La cascada mantiene su agotamiento actual. No se modificaron EMA 10/55, ADX 23, StochRSI ni TP/SL/BE.
- El informe V2.1 desglosa operaciones cerradas por LONG/SHORT y por cada ranura (principal, cada Multi-TF y las dos cascadas), con PF, expectativa, aciertos, P&L, comisiones y funding. Cada operación conserva las pendientes ADX/SQZMOM, distancia a EMA10/55 y estado de agotamiento al momento de la señal.
- `compare.mjs` sigue reproduciendo las variantes exploratorias anteriores A (base) y B (DMI). `backtest.mjs` ejecuta el preset V2.1.

## Ejecutar

Se requiere Node.js 20 o superior. No hay dependencias externas.

```text
node --test
node --use-system-ca scripts/download-btc.mjs 2026-03-01 2026-09-01 data/btcusdt-perp.json
node scripts/backtest.mjs data/btcusdt-perp.json backtest-result.json
node scripts/compare.mjs data/btcusdt-perp.json comparison-result.json
```

Las fechas son UTC; el segundo día es exclusivo. `--use-system-ca` permite usar los certificados del sistema en este entorno Windows. Los datos e informes están excluidos de Git para evitar publicar archivos grandes. Cada informe contiene SHA-256 del archivo de datos para identificar el conjunto analizado.

## Probar señales en TradingView

El borrador experimental [`tradingview/MiBotTraderV2_1_BTC.pine`](tradingview/MiBotTraderV2_1_BTC.pine) es una **estrategia Pine v6** para el Strategy Report. En TradingView abre `BINANCE:BTCUSDT.P` en velas normales de **1 minuto** (no Heikin Ashi), abre Pine Editor, crea una estrategia nueva, sustituye su contenido por el archivo y pulsa **Add to chart / Añadir al gráfico**. Los comentarios de cada entrada identifican la ranura que ganó la prioridad. No publica un bot de órdenes reales.

Pine traduce la lógica de señales V2.1, pero **no comparte código ejecutable** con JavaScript. Para los marcos superiores usa la última vela confirmada con desplazamiento de una vela y `lookahead_on`, lo que evita usar datos futuros pero puede retrasar una señal un minuto respecto al laboratorio. Su emulador de órdenes puede diferir en aperturas con gap, orden intravela TP/SL y activación de breakeven. Fija una comisión hipotética de 0,05 % por lado, margen 10 % y nocional aproximado de 1.000 USDT; deja slippage en cero y no incluye funding histórico. Los límites de barras disponibles en tu plan de TradingView pueden impedir cubrir los mismos seis meses a 1m. **No compares su PF directamente con el JSON del laboratorio.**

Este archivo todavía **no se ha compilado en una cuenta de TradingView**. Si el editor muestra un error, conserva el número de línea y el mensaje para corregirlo antes de interpretar cualquier resultado.

## Alcance del resultado

El motor espera 55 velas diarias completas antes de abrir posiciones. Con datos del 1 de marzo al 1 de septiembre de 2026, el período operable empieza el 25 de abril de 2026. El resultado sigue siendo **exploratorio**: no hubo partición entrenamiento/validación/final, barrido de costos ni verificación de señales contra TradingView. Tampoco modela bid/ask real, mark price, órdenes limitadas, latencia ni reglas de liquidación de Binance.

El `index.html` usa el motor compartido para señales, pero la **ejecución** sigue siendo diferente: la página hace paper trading continuo y muestra P&L bruto, sin comisiones ni funding, mientras el histórico simula costos y funding. Por ello una operación de la página no debe compararse directamente con el P&L neto del backtester.

**Definiciones V4 todavía abiertas:** la conversación compartida no fija un umbral de distancia precio/EMA ni una condición precisa para aceptar/rechazar una entrada según las pendientes ADX y SQZMOM. V2.1 registra esas medidas como diagnósticos, pero no las usa como filtros. Elegir límites numéricos ahora sería introducir parámetros no acordados. VPOC, régimen y walk-forward quedan para etapas posteriores.

En la primera corrida de seis meses (264.960 velas, 552 eventos de funding), A cerró 143 operaciones, con profit factor 0,81 y pérdida neta media de 1,51 USDT por cierre. B cerró 141, con profit factor 0,81 y pérdida media de 1,44 USDT. Ambas usaron 100 USDT de margen por entrada sobre una cuenta de 100.000 USDT; el drawdown porcentual de cuenta es pequeño por ese tamaño de posición. Estos números no demuestran una ventaja estadística ni que DMI mejore la estrategia. Al ejecutar `compare.mjs`, el archivo local `comparison-result.json` conserva las operaciones y el identificador SHA-256 de los datos usados.

En la misma muestra, el preset V2.1 cerró 142 operaciones (68 LONG, 74 SHORT), PF 0,80 y expectativa −1,58 USDT por cierre. LONG: PF 0,74 y −2,06 USDT; SHORT: PF 0,85 y −1,15 USDT. La ranura 1m aportó 96 cierres con PF 0,68; la cascada completa no produjo cierres. Son diagnósticos dentro de muestra, no evidencia de rentabilidad ni de que una ranura con pocas operaciones tenga ventaja. El archivo `backtest-result.json` generado localmente contiene el desglose completo.

## Próximas etapas

1. Congelar las definiciones cuantitativas de extensión EMA y pendientes ADX/SQZMOM antes de activarlas como filtros; crear casos independientes para confirmar señales contra TradingView.
2. Definir VPOC con datos de volumen por precio adecuados; las velas OHLCV de un minuto no permiten reconstruir un Volume Profile exacto.
3. Ampliar la ejecución con mark price, spread histórico, reglas de órdenes y liquidación; ejecutar sensibilidad a costos.
4. Evaluar A/B/C/D con períodos cronológicos separados y resultados por long/short, ranura, régimen y marco temporal. Fijar hipótesis y parámetros antes de abrir el período final.
5. Tras una validación estable, migrar la simulación continua a un servicio persistente. La conexión para órdenes reales necesita una revisión independiente.

# Mi Bot Trader — laboratorio BTC

Este laboratorio parte del `index.html` público de MiBotTraderV2. La página sigue siendo una cuenta ficticia. El laboratorio histórico está en `lab/` y `scripts/` y no envía órdenes.

## Qué se implementó

- La página simula solo BTCUSDT perpetual. Cambió a los endpoints públicos de futuros de Binance, corrigió una rama inalcanzable de la cascada y exige una señal nueva antes de reabrir.
- La cuenta ficticia BTC usa nuevas claves de `localStorage`; las claves anteriores siguen guardadas y no se borran.
- El laboratorio descarga velas de un minuto y eventos de funding de BTCUSDT USD-M perpetual. Rechaza huecos u OHLC inválidos.
- Reconstruye los marcos 1m, 3m, 5m, 15m, 1h, 4h y 1d solo con velas ya cerradas. Las entradas se llenan al minuto siguiente. TP y SL que coinciden en un minuto se resuelven a favor del SL.
- Simula margen de 100 USDT, 10x, costos de entrada y salida, deslizamiento configurable y funding histórico. Los costos por defecto son **supuestos de escenario**, no las tarifas de una cuenta Binance concreta.
- Compara A (señales existentes migradas a BTC) con B (A más confirmación `DI+ > DI−` para long y la inversa para short en motor principal y Multi-TF). La cascada conserva sus reglas. No cambia parámetros entre variantes.

## Ejecutar

Se requiere Node.js 20 o superior. No hay dependencias externas.

```text
node --test
node --use-system-ca scripts/download-btc.mjs 2026-03-01 2026-09-01 data/btcusdt-perp.json
node scripts/backtest.mjs data/btcusdt-perp.json backtest-result.json
node scripts/compare.mjs data/btcusdt-perp.json comparison-result.json
```

Las fechas son UTC; el segundo día es exclusivo. `--use-system-ca` permite usar los certificados del sistema en este entorno Windows. Los datos e informes están excluidos de Git para evitar publicar archivos grandes. Cada informe contiene SHA-256 del archivo de datos para identificar el conjunto analizado.

## Alcance del resultado

El motor espera 55 velas diarias completas antes de abrir posiciones. Con datos del 1 de marzo al 1 de septiembre de 2026, el período operable empieza el 25 de abril de 2026. El resultado sigue siendo **exploratorio**: no hubo partición entrenamiento/validación/final, barrido de costos ni verificación de señales contra TradingView. Tampoco modela bid/ask real, mark price, órdenes limitadas, latencia ni reglas de liquidación de Binance.

El `index.html` aún contiene su propio cálculo y muestra P&L bruto sin comisiones ni funding. El laboratorio tiene una prueba de paridad para EMA, ADX/DMI, SQZMOM y StochRSI frente a esas fórmulas; la integración de un único motor compartido entre página y laboratorio es el siguiente paso técnico.

En la primera corrida de seis meses (264.960 velas, 552 eventos de funding), A cerró 143 operaciones, con profit factor 0,81 y pérdida neta media de 1,51 USDT por cierre. B cerró 141, con profit factor 0,81 y pérdida media de 1,44 USDT. Ambas usaron 100 USDT de margen por entrada sobre una cuenta de 100.000 USDT; el drawdown porcentual de cuenta es pequeño por ese tamaño de posición. Estos números no demuestran una ventaja estadística ni que DMI mejore la estrategia. Al ejecutar `compare.mjs`, el archivo local `comparison-result.json` conserva las operaciones y el identificador SHA-256 de los datos usados.

## Próximas etapas

1. Extraer la evaluación de señales de la página hacia el mismo módulo puro del laboratorio y comparar las señales de ambos motores vela por vela.
2. Crear casos de referencia independientes de TradingView para confirmar definiciones y tiempos de EMA, ADX/DMI, SQZMOM y StochRSI.
3. Definir VPOC con datos de volumen por precio adecuados; las velas OHLCV de un minuto no permiten reconstruir un Volume Profile exacto.
4. Ampliar la ejecución con mark price, spread histórico, reglas de órdenes y liquidación; ejecutar sensibilidad a costos.
5. Evaluar A/B/C/D con períodos cronológicos separados y resultados por long/short, régimen y marco temporal. Fijar hipótesis y parámetros antes de abrir el período final.
6. Tras una validación estable, migrar la simulación continua a un servicio persistente. La conexión para órdenes reales necesita una revisión independiente.

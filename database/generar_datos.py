"""
Generador de datos de demo coherentes para el CRM Inmobiliario D'LOGIA.

Rango: 1-ene-2024 a 30-jun-2026 (fecha de corte). Todo sale de reglas de
negocio fijas y una semilla fija, así que cada ejecución produce lo mismo.

Reglas principales
- Cada venta (negocio "Ganado") tiene su cliente en Clientes y su plan de
  pagos en Financiero. No hay clientes ni pagos huérfanos.
- Vendidas / Reservadas / Disponibles / Estado de cada proyecto son FÓRMULAS
  que cuentan los negocios del proceso de venta: si un negocio cambia de
  etapa, el inventario se actualiza solo.
- Precios por m² con valorización mensual (~9% anual; VIS ~5%), así que una
  unidad vendida en 2024 cuesta menos que una de 2026.
- Estacionalidad colombiana: enero flojo, Semana Santa baja, primas
  (jun/dic) y ferias de vivienda (oct/nov) altas. Mercado 2024 débil,
  recuperación en 2025.
- Plan de pagos: cuota inicial (30%, VIS 20%) con separación + cuotas
  mensuales hasta la entrega; saldo por escrituración (crédito/subsidio) al
  entregar. Solo Altavista Park y Valle Verde ya entregaron.

Uso:  python database/generar_datos.py      -> escribe database/generado/*.json
"""
import json
import random
import unicodedata
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

SEMILLA = 20240101
INICIO = date(2024, 1, 1)
CORTE = date(2026, 6, 30)
rnd = random.Random(SEMILLA)

HOJA_PIPE = "'📋 Pipeline Comercial'"
# El Sheets está en configuración regional de Colombia: las fórmulas separan
# argumentos con ";" y los decimales usan ",". Con "," las fórmulas dan #ERROR!.
SEP, DEC = ";", ","

# ── PROYECTOS ────────────────────────────────────────────────────────────
# precio_m2: valor a la fecha de corte (jun-2026). meta: ventas en el rango.
# abiertos: negocios en curso a la fecha de corte.
PROYECTOS = [
    dict(id="PRY-001", nombre="Torres del Poblado", tipo="Apartamentos", ciudad="Medellín", sector="El Poblado",
         total=120, precio_m2=9_500_000, area=(65, 95), unidad="Apto", lanzamiento=date(2024, 1, 1),
         fin_ventas=CORTE, meta=100, abiertos=12, entrega=date(2027, 6, 15), ci=0.30, val=0.0072, ciclo=(35, 120)),
    dict(id="PRY-002", nombre="Reserva Santa Elena", tipo="Casas", ciudad="Medellín", sector="Santa Elena",
         total=60, precio_m2=6_800_000, area=(110, 130), unidad="Casa", lanzamiento=date(2024, 3, 1),
         fin_ventas=CORTE, meta=46, abiertos=8, entrega=date(2027, 12, 15), ci=0.30, val=0.0072, ciclo=(60, 150)),
    dict(id="PRY-003", nombre="Conecta Laureles", tipo="Aptos. Estudio", ciudad="Medellín", sector="Laureles",
         total=200, precio_m2=7_200_000, area=(42, 60), unidad="Apto", lanzamiento=date(2024, 1, 1),
         fin_ventas=CORTE, meta=165, abiertos=18, entrega=date(2026, 12, 15), ci=0.30, val=0.0072, ciclo=(25, 90)),
    dict(id="PRY-004", nombre="Altavista Park", tipo="Casas", ciudad="Medellín", sector="Altavista",
         total=80, precio_m2=5_900_000, area=(85, 110), unidad="Casa", lanzamiento=date(2024, 1, 1),
         fin_ventas=date(2025, 4, 30), meta=80, abiertos=0, entrega=date(2025, 11, 15), ci=0.30, val=0.0072, ciclo=(40, 120)),
    dict(id="PRY-005", nombre="Ciudadela Rionegro", tipo="Aptos. / Casas", ciudad="Rionegro", sector="Centro",
         total=150, precio_m2=4_800_000, area=(75, 105), unidad="Mixto", lanzamiento=date(2024, 6, 1),
         fin_ventas=CORTE, meta=95, abiertos=20, entrega=date(2027, 3, 15), ci=0.30, val=0.0072, ciclo=(35, 120)),
    dict(id="PRY-006", nombre="Plaza Bello", tipo="Locales Comercial", ciudad="Bello", sector="Centro",
         total=40, precio_m2=8_100_000, area=(55, 110), unidad="Local", lanzamiento=date(2025, 6, 1),
         fin_ventas=CORTE, meta=24, abiertos=9, entrega=date(2028, 1, 15), ci=0.30, val=0.0072, ciclo=(45, 140)),
    dict(id="PRY-007", nombre="Mirador de Envigado", tipo="Apartamentos", ciudad="Envigado", sector="Loma del Escobero",
         total=90, precio_m2=8_700_000, area=(65, 95), unidad="Apto", lanzamiento=date(2024, 9, 1),
         fin_ventas=CORTE, meta=58, abiertos=14, entrega=date(2027, 9, 15), ci=0.30, val=0.0072, ciclo=(35, 120)),
    dict(id="PRY-008", nombre="Valle Verde Itagüí", tipo="Casas VIS", ciudad="Itagüí", sector="Santa María",
         total=110, precio_m2=3_200_000, area=(45, 60), unidad="Casa", lanzamiento=date(2024, 1, 1),
         fin_ventas=CORTE, meta=104, abiertos=4, entrega=date(2026, 3, 15), ci=0.20, val=0.0040, ciclo=(20, 70)),
]

# ── ASESORES ─────────────────────────────────────────────────────────────
# peso: capacidad comercial relativa. desde: fecha de ingreso al equipo.
ASESORES = [
    ("Luis Bedoya", 1.50, INICIO), ("Sofía Prada", 1.35, INICIO), ("Ana Quintero", 1.20, INICIO),
    ("Miguel Salazar", 1.10, INICIO), ("Andrés Torres", 1.00, INICIO), ("Paula Arenas", 0.95, INICIO),
    ("Juliana Vélez", 0.85, INICIO), ("Santiago Muñoz", 0.80, date(2024, 4, 1)),
    ("Daniela Ríos", 0.70, date(2025, 2, 1)), ("Mateo Herrera", 0.60, date(2025, 7, 1)),
]

# ── MERCADO ──────────────────────────────────────────────────────────────
ESTACION = {1: 0.70, 2: 0.90, 3: 1.00, 4: 0.85, 5: 1.00, 6: 1.15, 7: 0.95, 8: 1.00, 9: 1.05, 10: 1.25, 11: 1.20, 12: 1.10}
MERCADO = {2024: 0.85, 2025: 1.10, 2026: 1.05}

# Fuente: participación en el volumen de prospectos y tasa de compra
FUENTES = {"Portal Web": (0.30, 0.18), "Facebook": (0.20, 0.10), "Instagram": (0.17, 0.09),
           "Feria Inmobiliaria": (0.12, 0.30), "Llamada directa": (0.10, 0.26), "Referido": (0.11, 0.45)}

ETAPAS_ABIERTAS = [("Prospección", 0.22), ("Contacto Inicial", 0.20), ("Visita Inmueble", 0.16),
                   ("Propuesta Económica", 0.14), ("Negociación", 0.15), ("Cierre", 0.13)]
PROB = {"Prospección": 0.1, "Contacto Inicial": 0.2, "Visita Inmueble": 0.4, "Propuesta Económica": 0.6,
        "Negociación": 0.75, "Cierre": 0.9, "Ganado": 1, "Perdido": 0}
ESTADO_CLIENTE = {"Prospección": "Nuevo lead", "Contacto Inicial": "En contacto", "Visita Inmueble": "Visita agendada",
                  "Propuesta Económica": "Propuesta enviada", "Negociación": "Negociación", "Cierre": "Negociación",
                  "Ganado": "Ganado", "Perdido": "Perdido"}
OBS_ABIERTO = {"Prospección": ["Solicitó información por formulario", "Pidió brochure y precios"],
               "Contacto Inicial": ["Primera llamada realizada", "Interesado, pidió plano de la unidad"],
               "Visita Inmueble": ["Visita a sala de ventas agendada", "Visitó el apartamento modelo"],
               "Propuesta Económica": ["Cotización enviada", "Evaluando plan de pagos"],
               "Negociación": ["Negociando descuento por pago de contado", "Requiere aprobación de crédito"],
               "Cierre": ["Separación en trámite", "Firma de promesa de compraventa programada"]}
MOTIVOS_PERDIDA = [("Crédito no aprobado", 0.26), ("Eligió otro proyecto", 0.22), ("Precio fuera de presupuesto", 0.20),
                   ("Desistió de la compra", 0.14), ("No volvió a responder", 0.12), ("Cambió de ciudad", 0.06)]
MOTIVOS_DESCARTE = [("Sin respuesta tras 3 contactos", 0.34), ("No calificó para crédito", 0.22),
                    ("Buscaba arriendo, no compra", 0.16), ("Presupuesto insuficiente", 0.18), ("Datos de contacto errados", 0.10)]

NOMBRES = ["Alejandra", "Andrés", "Camila", "Carlos", "Carolina", "Daniel", "David", "Diana", "Diego", "Esteban",
           "Felipe", "Gabriel", "Isabel", "Iván", "Jorge", "José", "Juan Pablo", "Julián", "Laura", "Lorena",
           "Luisa", "Manuela", "Marcela", "María", "Mariana", "Mateo", "Natalia", "Nicolás", "Paola", "Paula",
           "Ricardo", "Sandra", "Santiago", "Sara", "Sebastián", "Simón", "Sofía", "Tomás", "Valentina", "Valeria",
           "Verónica", "Alejandro", "Catalina", "Cristian", "Daniela", "Fernando", "Gloria", "Hernán", "Jhon", "Katherine",
           "Liliana", "Mauricio", "Mónica", "Óscar", "Patricia", "Rodrigo", "Juliana", "Emilio", "Ximena", "Wilson"]
APELLIDOS = ["Arango", "Betancur", "Cano", "Cardona", "Castaño", "Cifuentes", "Correa", "Duque", "Escobar", "Espinosa",
             "Franco", "Gaviria", "Giraldo", "Gómez", "Henao", "Hernández", "Higuita", "Jaramillo", "Londoño", "López",
             "Marín", "Mejía", "Montoya", "Montes", "Muñoz", "Ochoa", "Osorio", "Palacio", "Peláez", "Pérez",
             "Quintero", "Ramírez", "Restrepo", "Ríos", "Rojas", "Salazar", "Salcedo", "Sánchez", "Toro", "Uribe",
             "Valencia", "Vargas", "Vásquez", "Vélez", "Zapata", "Zuluaga", "Agudelo", "Álvarez", "Bedoya", "Echeverri"]
CIUDADES = ["Medellín", "Envigado", "Itagüí", "Bello", "Sabaneta", "Rionegro", "La Estrella"]


# ── UTILIDADES ───────────────────────────────────────────────────────────
def elegir(pares):
    """Elige una opción de [(valor, peso), ...]."""
    return rnd.choices([p[0] for p in pares], weights=[p[1] for p in pares])[0]


def meses(desde, hasta):
    y, m = desde.year, desde.month
    while (y, m) <= (hasta.year, hasta.month):
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def dia_en_mes(y, m, minimo=INICIO, maximo=CORTE):
    ultimo = (date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)).day
    d = date(y, m, rnd.randint(1, ultimo))
    return min(max(d, minimo), maximo)


def sumar_meses(d, n):
    y, m = d.year + (d.month - 1 + n) // 12, (d.month - 1 + n) % 12 + 1
    ultimo = (date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)).day
    return date(y, m, min(d.day, ultimo))


def meses_entre(a, b):
    return (b.year - a.year) * 12 + (b.month - a.month)


def precio_m2(p, fecha):
    """Precio por m² en una fecha, descontando la valorización desde el corte."""
    return p["precio_m2"] / (1 + p["val"]) ** max(0, meses_entre(fecha, CORTE))


def asesor_activo(fecha):
    activos = [(n, w) for n, w, desde in ASESORES if desde <= fecha]
    return elegir(activos)


def sin_tildes(s):
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


_usados = set()


def persona():
    while True:
        n = f"{rnd.choice(NOMBRES)} {rnd.choice(APELLIDOS)} {rnd.choice(APELLIDOS)}"
        if n not in _usados:
            _usados.add(n)
            break
    partes = sin_tildes(n).lower().split()
    email = f"{partes[0]}.{partes[-2]}{rnd.randint(1, 99)}@{rnd.choice(['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com'])}"
    tel = f"3{rnd.choice(['00', '01', '04', '10', '13', '14', '15', '17', '20', '22', '23', '24'])}{rnd.randint(1000000, 9999999)}"
    return n, tel, email


def unidades(p):
    """Lista fija de unidades (código, área m², prima por piso) del proyecto."""
    out = []
    tipo = p["unidad"]
    for i in range(p["total"]):
        t = tipo if tipo != "Mixto" else ("Apto" if i < 100 else "Casa")
        if t == "Apto":
            por_piso = 6 if p["total"] <= 120 else 8
            piso, n = 2 + i // por_piso, i % por_piso + 1
            codigo, prima = f"Apto {piso}{n:02d}", 1 + 0.006 * piso
        else:
            codigo, prima = f"{t} {i + 1 - (100 if tipo == 'Mixto' else 0)}", 1.0
        out.append((codigo, rnd.randint(*p["area"]), prima))
    return out


def valor_unidad(p, u, fecha):
    _, area, prima = u
    return round(area * precio_m2(p, fecha) * prima / 1_000_000) * 1_000_000


def fecha_ventas(p, n):
    """Reparte n fechas en la vida comercial del proyecto según estacionalidad y mercado."""
    ms = list(meses(p["lanzamiento"], p["fin_ventas"]))
    pesos = []
    for i, (y, m) in enumerate(ms):
        w = ESTACION[m] * MERCADO[y]
        if i < 3:
            w *= 1.6  # preventa / lanzamiento
        pesos.append(w * rnd.uniform(0.9, 1.1))  # variación leve mes a mes
    # Reparto por mayor residuo: la estacionalidad se nota sin depender del azar
    total = sum(pesos)
    esperado = [n * w / total for w in pesos]
    conteo = [int(e) for e in esperado]
    for i in sorted(range(len(ms)), key=lambda i: esperado[i] - conteo[i], reverse=True)[:n - sum(conteo)]:
        conteo[i] += 1
    # Ninguna venta cierra antes del ciclo mínimo contado desde el inicio del rango
    minimo = max(p["lanzamiento"], INICIO + timedelta(days=p["ciclo"][0]))
    fechas = [dia_en_mes(y, m, minimo=minimo, maximo=p["fin_ventas"])
              for (y, m), c in zip(ms, conteo) for _ in range(c)]
    return sorted(fechas)


# ── GENERACIÓN ───────────────────────────────────────────────────────────
negocios, clientes, pagos = [], [], []


def fuente_para(peso_conversion):
    pares = [(f, s * (c if peso_conversion else (1 - c))) for f, (s, c) in FUENTES.items()]
    return elegir(pares)


for p in PROYECTOS:
    us = unidades(p)
    rnd.shuffle(us)
    vendidas, resto = us[:p["meta"]], us[p["meta"]:]

    # Ventas
    for u, cierre in zip(vendidas, fecha_ventas(p, p["meta"])):
        ciclo = rnd.randint(*p["ciclo"])
        apertura = max(INICIO, cierre - timedelta(days=ciclo))
        negocios.append(dict(p=p, unidad=u, etapa="Ganado", apertura=apertura, cierre=cierre,
                             asesor=asesor_activo(apertura), valor=valor_unidad(p, u, cierre),
                             dias=(cierre - apertura).days, obs="Promesa de compraventa firmada"))

    # Perdidos: ~45% de las ventas, con su motivo
    for cierre in fecha_ventas(p, round(p["meta"] * 0.45)):
        u = rnd.choice(us)
        ciclo = rnd.randint(*p["ciclo"])
        apertura = max(INICIO, cierre - timedelta(days=ciclo))
        negocios.append(dict(p=p, unidad=u, etapa="Perdido", apertura=apertura, cierre=cierre,
                             asesor=asesor_activo(apertura), valor=valor_unidad(p, u, apertura),
                             dias=(cierre - apertura).days, obs=elegir(MOTIVOS_PERDIDA)))

    # En curso a la fecha de corte (sobre unidades todavía libres)
    for u in resto[:p["abiertos"]]:
        etapa = elegir(ETAPAS_ABIERTAS)
        orden = [e for e, _ in ETAPAS_ABIERTAS].index(etapa)
        antiguedad = rnd.randint(3 + orden * 8, 40 + orden * 22)
        apertura = CORTE - timedelta(days=antiguedad)
        # ~1 de cada 4 negocios abiertos está estancado (>30 días en la etapa)
        dias = rnd.randint(31, max(32, antiguedad)) if rnd.random() < 0.25 else rnd.randint(1, min(30, antiguedad))
        negocios.append(dict(p=p, unidad=u, etapa=etapa, apertura=apertura,
                             cierre=CORTE + timedelta(days=rnd.randint(10, 120)),
                             asesor=asesor_activo(apertura), valor=valor_unidad(p, u, apertura),
                             dias=min(dias, antiguedad), obs=rnd.choice(OBS_ABIERTO[etapa])))

negocios.sort(key=lambda n: (n["apertura"], n["p"]["id"]))

# Clientes de los negocios (uno por negocio)
for i, n in enumerate(negocios):
    nombre, tel, email = persona()
    n["cliente"] = nombre
    contacto = max(INICIO, n["apertura"] - timedelta(days=rnd.randint(0, 25)))
    if n["etapa"] == "Ganado":
        seguimiento, obs = n["cierre"] + timedelta(days=30), f"Compró {n['unidad'][0]} en {n['p']['nombre']}"
    elif n["etapa"] == "Perdido":
        seguimiento, obs = n["cierre"], n["obs"]
    else:
        seguimiento, obs = CORTE + timedelta(days=rnd.randint(1, 14)), n["obs"]
    ciudad = n["p"]["ciudad"] if rnd.random() < 0.55 else rnd.choice(CIUDADES)
    clientes.append(dict(nombre=nombre, tel=tel, email=email, ciudad=ciudad, proyecto=n["p"]["id"],
                         fuente=fuente_para(n["etapa"] == "Ganado"), asesor=n["asesor"],
                         estado=ESTADO_CLIENTE[n["etapa"]], contacto=contacto, seguimiento=seguimiento, obs=obs))

# Prospectos que no llegaron a negocio: completan ~22% de conversión total
extra = round(len([n for n in negocios if n["etapa"] == "Ganado"]) / 0.22) - len(clientes)
pesos_mes = [(ym, ESTACION[ym[1]] * MERCADO[ym[0]]) for ym in meses(INICIO, CORTE)]
for _ in range(extra):
    y, m = elegir(pesos_mes)
    contacto = dia_en_mes(y, m)
    nombre, tel, email = persona()
    p = rnd.choice([q for q in PROYECTOS if q["lanzamiento"] <= contacto <= q["fin_ventas"]] or PROYECTOS)
    reciente = (CORTE - contacto).days <= 45
    if reciente:
        estado, obs = elegir([("Nuevo lead", 0.6), ("En contacto", 0.4)]), "Pendiente de primera llamada"
        seguimiento = CORTE + timedelta(days=rnd.randint(1, 10))
    else:
        estado, obs = "Perdido", elegir(MOTIVOS_DESCARTE)
        seguimiento = contacto + timedelta(days=rnd.randint(5, 30))
    clientes.append(dict(nombre=nombre, tel=tel, email=email,
                         ciudad=p["ciudad"] if rnd.random() < 0.5 else rnd.choice(CIUDADES),
                         proyecto=p["id"], fuente=fuente_para(False), asesor=asesor_activo(contacto),
                         estado=estado, contacto=contacto, seguimiento=min(seguimiento, CORTE + timedelta(days=14)),
                         obs=obs))

clientes.sort(key=lambda c: c["contacto"])

# Plan de pagos de cada venta
for n in sorted((n for n in negocios if n["etapa"] == "Ganado"), key=lambda n: n["cierre"]):
    p, precio, venta = n["p"], n["valor"], n["cierre"]
    ci_total = round(precio * p["ci"] / 1_000_000) * 1_000_000
    separacion = 3_000_000 if p["ci"] < 0.3 else 10_000_000
    cuotas = max(1, meses_entre(venta, p["entrega"]) - 1)
    cuota = (ci_total - separacion) / cuotas
    vencimientos = [sumar_meses(venta, k) for k in range(1, cuotas + 1)]
    debidas = sum(1 for v in vencimientos if v <= CORTE)
    terminado = debidas >= cuotas
    atraso = 0
    if rnd.random() < (0.03 if terminado else 0.09):
        atraso = min(debidas, rnd.randint(1, 4))
    pagadas = debidas - atraso
    pagado = min(ci_total, round(separacion + cuota * pagadas))
    if atraso:
        estado, compromiso = "En mora", vencimientos[pagadas]
    elif pagadas >= cuotas:
        estado, compromiso, pagado = "Pagado", vencimientos[-1], ci_total
    else:
        estado, compromiso = "Al día", vencimientos[pagadas]
    pagos.append(dict(cliente=n["cliente"], p=p, concepto="Cuota inicial", total=ci_total, pagado=pagado,
                      compromiso=compromiso, estado=estado, asesor=n["asesor"]))

    # Escrituración: solo proyectos ya entregados
    if p["entrega"] <= CORTE and estado != "En mora":
        saldo = precio - ci_total
        dias_desde = (CORTE - p["entrega"]).days
        r = rnd.random()
        if dias_desde > 150 or r < 0.75:
            pagos.append(dict(cliente=n["cliente"], p=p, concepto="Escrituración", total=saldo, pagado=saldo,
                              compromiso=p["entrega"] + timedelta(days=rnd.randint(15, 90)), estado="Pagado",
                              asesor=n["asesor"]))
        else:
            pagos.append(dict(cliente=n["cliente"], p=p, concepto="Escrituración", total=saldo, pagado=0,
                              compromiso=CORTE + timedelta(days=rnd.randint(10, 60)),
                              estado="Pendiente" if r < 0.95 else "En mora", asesor=n["asesor"]))


# ── FILAS PARA LA HOJA (orden de columnas A..L, datos desde la fila 3) ─────
iso = lambda d: d.isoformat()

filas_proy = []
for i, p in enumerate(PROYECTOS):
    r = i + 3
    contar = lambda etapa: f'COUNTIFS({HOJA_PIPE}!$C$3:$C{SEP}A{r}{SEP}{HOJA_PIPE}!$F$3:$F{SEP}"{etapa}")'
    filas_proy.append([
        p["id"], p["nombre"], p["tipo"], p["ciudad"], p["sector"], p["total"],
        f"={contar('Ganado')}",
        f"={contar('Negociación')}+{contar('Cierre')}",
        f"=F{r}-G{r}-H{r}", p["precio_m2"],
        f'=IF(I{r}<=0{SEP}"Agotado"{SEP}IF(G{r}/F{r}>=0{DEC}9{SEP}"Casi agotado"{SEP}"En venta"))',
    ])

filas_cli = [[f"CLI-{i + 1:04d}", c["nombre"], c["tel"], c["email"], c["ciudad"], c["proyecto"], c["fuente"],
              c["asesor"], c["estado"], iso(c["contacto"]), iso(c["seguimiento"]), c["obs"]]
             for i, c in enumerate(clientes)]

filas_pipe = [[f"NEG-{i + 1:04d}", n["cliente"], n["p"]["id"], n["unidad"][0], n["asesor"], n["etapa"], n["valor"],
               PROB[n["etapa"]], iso(n["apertura"]), iso(n["cierre"]), n["dias"], n["obs"]]
              for i, n in enumerate(negocios)]

filas_fin = []
for i, g in enumerate(pagos):
    r = i + 3
    filas_fin.append([f"PAG-{i + 1:04d}", g["cliente"], g["p"]["id"], g["concepto"], g["total"], g["pagado"],
                      f"=E{r}-F{r}", f"=IF(E{r}>0{SEP}F{r}/E{r}{SEP}0)", iso(g["compromiso"]), g["estado"], g["asesor"]])

out = Path(__file__).parent / "generado"
out.mkdir(exist_ok=True)
for nombre, filas in [("PROYECTOS", filas_proy), ("CLIENTES", filas_cli), ("PIPELINE", filas_pipe), ("FINANCIERO", filas_fin)]:
    (out / f"{nombre.lower()}.json").write_text(json.dumps(filas, ensure_ascii=False), encoding="utf-8")


# ── RESUMEN PARA REVISIÓN ────────────────────────────────────────────────
def M(v):
    return f"${v / 1e6:,.0f}M".replace(",", ".")


ganados = [n for n in negocios if n["etapa"] == "Ganado"]
print(f"Filas: proyectos {len(filas_proy)} | clientes {len(filas_cli)} | negocios {len(filas_pipe)} | pagos {len(filas_fin)}")
print(f"Ventas {len(ganados)} | perdidos {sum(n['etapa'] == 'Perdido' for n in negocios)} | "
      f"en curso {sum(n['etapa'] not in ('Ganado', 'Perdido') for n in negocios)} | "
      f"conversión prospecto→compra {len(ganados) / len(clientes):.1%}")

print("\nVENTAS POR AÑO")
for y, etq in [(2024, "2024"), (2025, "2025"), (2026, "2026 S1")]:
    vs = [n for n in ganados if n["cierre"].year == y]
    print(f"  {etq:8} {len(vs):4} ventas  {M(sum(n['valor'] for n in vs)):>10}  ticket prom {M(sum(n['valor'] for n in vs) / max(1, len(vs)))}")

print("\nVENTAS POR SEMESTRE")
for y in (2024, 2025, 2026):
    for s in (1, 2):
        vs = [n for n in ganados if n["cierre"].year == y and (n["cierre"].month <= 6) == (s == 1)]
        if vs or (y, s) != (2026, 2):
            print(f"  {y}-S{s}: {len(vs):4}")

print("\nPOR PROYECTO  (vendidas/total | en curso | precio venta 2024 → 2026)")
for p in PROYECTOS:
    vs = [n for n in ganados if n["p"] is p]
    cur = [n for n in negocios if n["p"] is p and n["etapa"] not in ("Ganado", "Perdido")]
    reserv = sum(n["etapa"] in ("Negociación", "Cierre") for n in cur)
    v24 = [n["valor"] for n in vs if n["cierre"].year == 2024]
    v26 = [n["valor"] for n in vs if n["cierre"].year == 2026]
    rango = f"{M(sum(v24) / len(v24)) if v24 else '—':>7} → {M(sum(v26) / len(v26)) if v26 else '—':>7}"
    print(f"  {p['nombre']:20} {len(vs):3}/{p['total']:3}  disp {p['total'] - len(vs) - reserv:3} | {len(cur):2} en curso | {rango}")

print("\nASESORES (ventas | valor)")
for a, c in Counter(n["asesor"] for n in ganados).most_common():
    print(f"  {a:16} {c:3}  {M(sum(n['valor'] for n in ganados if n['asesor'] == a))}")

print("\nFUENTES (prospectos | compras | conversión)")
for f in FUENTES:
    tot = sum(c["fuente"] == f for c in clientes)
    g = sum(c["fuente"] == f and c["estado"] == "Ganado" for c in clientes)
    print(f"  {f:20} {tot:5} {g:4}  {g / tot:.0%}")

print("\nCARTERA (pagos | total | pagado | pendiente)")
for e in ("Al día", "Pagado", "Pendiente", "En mora"):
    gs = [g for g in pagos if g["estado"] == e]
    print(f"  {e:10} {len(gs):4}  {M(sum(g['total'] for g in gs)):>9}  {M(sum(g['pagado'] for g in gs)):>9}  {M(sum(g['total'] - g['pagado'] for g in gs)):>9}")
activos = [g for g in pagos if g["estado"] != "Pagado"]
print(f"  Mora sobre planes activos: {sum(g['estado'] == 'En mora' for g in pagos) / len(activos):.1%}")

print("\nVENTAS POR MES")
pm = Counter((n["cierre"].year, n["cierre"].month) for n in ganados)
for y in (2024, 2025, 2026):
    print(f"  {y}: " + " ".join(f"{pm.get((y, m), 0):3}" for m in range(1, 13) if (y, m) <= (2026, 6)))

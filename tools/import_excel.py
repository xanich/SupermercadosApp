"""Extrae los ingredientes y precios del Excel a data/ingredients.json (solo libreria estandar)."""
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "compra supermercado 1.xlsx"
OUT = ROOT / "data" / "ingredients.json"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
M = "{%s}" % NS["m"]

# Texto de busqueda para BM/Eroski cuando el nombre del Excel es demasiado corto o ambiguo.
# Ingredientes que se compran por kilos: su precio es €/kg y la cantidad se mide en kg.
PESO = {
    "filetes carne", "doradas", "carne molida", "pollo", "pimiento rojo", "pimiento verde", "cebolla",
    "zanahorias", "tomate rama", "aguacate", "salmón congelado", "salmón fresco", "patatas", "mango",
}

QUERIES = {
    "carne molida": "carne picada",
    "filetes carne": "filetes ternera",
    "leche semi": "leche semidesnatada",
    "pollo": "pechuga de pollo",
    "tortillas trigo": "tortillas de trigo",
    "atún natural": "atún natural",
    "salmón congelado": "salmón congelado",
    "tallarines": "tallarines pasta",
    "salsa tomate": "salsa de tomate",
    "papel cocina": "papel de cocina",
    "papel higiénico": "papel higiénico",
    "cherries": "tomate cherry",
    "limas": "limas",
}


def slug(text: str) -> str:
    text = text.lower()
    for a, b in zip("áéíóúüñ", "aeiouun"):
        text = text.replace(a, b)
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")


def read_cells(path: Path):
    with zipfile.ZipFile(path) as z:
        shared = []
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in root.findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter(M + "t")))
        sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    cells = {}
    for c in sheet.iter(M + "c"):
        v = c.find("m:v", NS)
        if v is None or v.text is None:
            continue
        val = shared[int(v.text)] if c.get("t") == "s" else v.text
        cells[c.get("r")] = val
    return cells


def number(value):
    if value is None:
        return None
    try:
        return round(float(value), 4)
    except ValueError:
        return None  # "-" = no disponible


def main():
    cells = read_cells(XLSX)
    items = []
    for row in range(2, 32):
        name = cells.get(f"D{row}")
        if not name:
            continue
        items.append(
            {
                "id": slug(name),
                "nombre": name,
                "consulta": QUERIES.get(name, name),
                "modo": "peso" if name in PESO else "unidad",
                "precios_excel": {
                    "dia": number(cells.get(f"E{row}")),
                    "eroski": number(cells.get(f"F{row}")),
                    "bm": number(cells.get(f"G{row}")),
                    "carrefour": number(cells.get(f"H{row}")),
                },
            }
        )
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(items)} ingredientes -> {OUT}")


if __name__ == "__main__":
    sys.exit(main())

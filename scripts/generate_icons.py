# Génère les icônes PNG de la PWA (symbole € / Ft) avec Pillow uniquement.
# Usage : python scripts/generate_icons.py
#
# Produit dans icons/ :
#   icon-192.png            (purpose "any")
#   icon-512.png            (purpose "any")
#   icon-maskable-192.png   (purpose "maskable", zone de sécurité respectée)
#   icon-maskable-512.png   (purpose "maskable")

import os
from PIL import Image, ImageDraw, ImageFont

ICI = os.path.dirname(os.path.abspath(__file__))
DOSSIER_ICONES = os.path.join(os.path.dirname(ICI), 'icons')
os.makedirs(DOSSIER_ICONES, exist_ok=True)

COULEUR_FOND = (10, 110, 78, 255)   # vert accent de l'app (--accent)
COULEUR_TEXTE = (255, 255, 255, 255)

CHEMIN_POLICE_BOLD = r"C:\Windows\Fonts\segoeuib.ttf"


def police(taille):
    return ImageFont.truetype(CHEMIN_POLICE_BOLD, taille)


def dessiner_fleche_verticale(dessin, cx, y_haut, y_bas, largeur_trait, taille_pointe):
    """Dessine une double flèche verticale (haut <-> bas) = symbole d'échange."""
    dessin.line([(cx, y_haut), (cx, y_bas)], fill=COULEUR_TEXTE, width=largeur_trait)
    # pointe du haut
    dessin.polygon([
        (cx - taille_pointe, y_haut + taille_pointe),
        (cx + taille_pointe, y_haut + taille_pointe),
        (cx, y_haut),
    ], fill=COULEUR_TEXTE)
    # pointe du bas
    dessin.polygon([
        (cx - taille_pointe, y_bas - taille_pointe),
        (cx + taille_pointe, y_bas - taille_pointe),
        (cx, y_bas),
    ], fill=COULEUR_TEXTE)


def texte_centre(dessin, texte, cx, cy, fnt):
    boite = dessin.textbbox((0, 0), texte, font=fnt)
    largeur = boite[2] - boite[0]
    hauteur = boite[3] - boite[1]
    dessin.text((cx - largeur / 2 - boite[0], cy - hauteur / 2 - boite[1]), texte, font=fnt, fill=COULEUR_TEXTE)


def creer_icone(taille, maskable):
    img = Image.new('RGBA', (taille, taille), (0, 0, 0, 0))
    dessin = ImageDraw.Draw(img)

    if maskable:
        # Les icônes maskable doivent couvrir tout le carré (l'OS applique son propre masque).
        dessin.rectangle([0, 0, taille, taille], fill=COULEUR_FOND)
        marge = taille * 0.22  # zone de sécurité : contenu dans les 80% centraux
    else:
        rayon = int(taille * 0.18)
        dessin.rounded_rectangle([0, 0, taille - 1, taille - 1], radius=rayon, fill=COULEUR_FOND)
        marge = taille * 0.12

    zone_haut = marge
    zone_bas = taille - marge
    hauteur_zone = zone_bas - zone_haut

    # 3 bandes : "€" / flèche d'échange / "Ft"
    y_eur = zone_haut + hauteur_zone * 0.19
    y_fleche_haut = zone_haut + hauteur_zone * 0.38
    y_fleche_bas = zone_haut + hauteur_zone * 0.62
    y_huf = zone_haut + hauteur_zone * 0.81

    fnt_texte = police(int(taille * 0.26))
    texte_centre(dessin, '€', taille / 2, y_eur, fnt_texte)
    texte_centre(dessin, 'Ft', taille / 2, y_huf, fnt_texte)

    dessiner_fleche_verticale(
        dessin, taille / 2, y_fleche_haut, y_fleche_bas,
        largeur_trait=max(2, int(taille * 0.022)),
        taille_pointe=int(taille * 0.045),
    )

    return img


for taille in (192, 512):
    creer_icone(taille, maskable=False).save(os.path.join(DOSSIER_ICONES, f'icon-{taille}.png'))
    creer_icone(taille, maskable=True).save(os.path.join(DOSSIER_ICONES, f'icon-maskable-{taille}.png'))

print('Icônes générées dans', DOSSIER_ICONES)

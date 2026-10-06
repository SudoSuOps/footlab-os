import sys, json, io, html
from pathlib import Path
import reportlab
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from datetime import datetime
from zoneinfo import ZoneInfo
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, PageBreak, KeepTogether
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.utils import ImageReader

if '--check' in sys.argv:
    sys.exit(0)
data = json.load(sys.stdin)
manifest, proof = data['manifest'], data['proofHash']
review = manifest['review']
buf = io.BytesIO()
font_root = Path(reportlab.__file__).parent / 'fonts'
pdfmetrics.registerFont(TTFont('FloSans', str(font_root / 'Vera.ttf')))
pdfmetrics.registerFont(TTFont('FloSansBold', str(font_root / 'VeraBd.ttf')))
pdfmetrics.registerFontFamily('FloSans', normal='FloSans', bold='FloSansBold', italic='FloSans', boldItalic='FloSansBold')
styles = getSampleStyleSheet()
for style in styles.byName.values():
    if hasattr(style, 'fontName'):
        style.fontName = 'FloSansBold' if 'Bold' in style.fontName else 'FloSans'
styles.add(ParagraphStyle('FloTitle', fontName='FloSansBold', fontSize=24, leading=30, spaceAfter=14, textColor=HexColor('#111516')))
styles.add(ParagraphStyle('FloBody', fontName='FloSans', fontSize=10, leading=15, spaceAfter=10))
styles.add(ParagraphStyle('FloSmall', fontName='FloSans', fontSize=8, leading=11, spaceAfter=6))
esc = lambda s: html.escape(str(s))
def p(text, style='FloBody'): return Paragraph(esc(text).replace('\n', '<br/>'), styles[style])
date = datetime.fromisoformat(manifest['receipt']['receivedAt'].replace('Z','+00:00')).astimezone(ZoneInfo('America/New_York')).strftime('%B %d, %Y · %I:%M %p %Z')
logo = Path(__file__).resolve().parent.parent / 'apps/client-link/assets/footlabos-horizontal-light.png'
story = ([Image(str(logo), width=260, height=78, hAlign='LEFT'), Spacer(1,16)] if logo.exists() else []) + [p('Your FLO check-in', 'FloTitle'), p('Your daily check-in record', 'Heading2'), p(date),
         p('EXPERIMENTAL • UNVERIFIED • HUMAN REVIEW REQUIRED', 'Heading3'),
         p('This report records your submitted check-in and model-generated descriptions. It does not establish healing, infection status, sensation or circulation. No clinician has approved these observations.'),
         p('Check-in: ' + manifest['receipt']['requestId'], 'FloSmall'),
         p('Photos received: ' + str(manifest['receipt']['photoCount'])),
         p('Model: ' + review['model']), p('Model digest: ' + review['modelDigest'][:32] + '\n' + review['modelDigest'][32:], 'FloSmall')]
if manifest.get('checkIn'):
    story += [p('Your check-in answer', 'Heading2'), p('Reported change: ' + manifest['checkIn'].get('meaningfulChange','unspecified')),
              p(manifest['checkIn'].get('note','') or 'No note supplied.')]
flags = manifest['qualityFlags']
story += [p('Output quality checks', 'Heading2'), p(f'{len(flags)} automated flags. These checks inspect wording; they do not verify the photos or medical accuracy.')]
for flag in flags: story.append(p(flag['slot'] + ': ' + flag['code'], 'FloSmall'))
if not flags: story.append(p('No wording flags detected. This does not mean the observations are correct.'))
story += [p('Proof of FLO', 'Heading2'), p('SHA-256 of the canonical capture-and-report manifest:', 'FloSmall'), p(proof[:32] + '\n' + proof[32:], 'FloSmall'),
          p('This fingerprint binds the receipt, ordered source image hashes, model/version, output text and quality flags. It proves consistency with the saved manifest; it does not prove clinical accuracy, authorship or an immutable timestamp.', 'FloSmall')]
for o in review['observations']:
    story += [PageBreak(), p(o['slot'].replace('-', ' ').title(), 'FloTitle'),
              p('Unverified model description', 'Heading2'), p(o['unverifiedModelText']),
              p('Source photo SHA-256', 'Heading3'), p(o['sourceSha256'][:32] + '\n' + o['sourceSha256'][32:], 'FloSmall')]
def footer(canvas, doc):
    w, h = doc.pagesize
    canvas.setFillColor(HexColor('#B6FF67')); canvas.rect(0,h-12,w,12,fill=1,stroke=0)
    canvas.setFillColor(HexColor('#111516')); canvas.setFont('FloSans',8)
    canvas.drawString(42,24,'FLO • Personal pilot • Unverified observations')
    canvas.drawRightString(w-42,24,str(doc.page))
SimpleDocTemplate(buf, pagesize=(612,792), rightMargin=42,leftMargin=42,topMargin=40,bottomMargin=44, title='FLO personal check-in report', author='FootLabOS').build(story, onFirstPage=footer, onLaterPages=footer)
sys.stdout.buffer.write(buf.getvalue())

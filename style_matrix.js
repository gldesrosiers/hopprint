// ============================================================
// Hopprint Style Attribute Matrix
// Full 153-style BJCP-grounded scoring across 8 flavor dimensions.
// Scale: 1-5 per dimension. Grounded in BJCP 2021 style guidelines.
// This is a static, shared reference — identical for every user.
// Personalization happens in the signal model, not here.
//
// Known limitation: tartness/salt is not a captured dimension, which
// causes some sour styles (e.g. Traditional Gose) to score artificially
// close to low-intensity lagers. Flagged, not yet fixed — revisit if
// this produces visibly bad recommendations in testing.
// ============================================================

const STYLE_MATRIX = {
  "Altbier - Traditional": {
    "bitterness": 3,
    "sweetness": 2,
    "roast": 2,
    "body": 3,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 2,
    "haze": 1
  },
  "Barleywine - American": {
    "bitterness": 5,
    "sweetness": 3,
    "roast": 1,
    "body": 5,
    "fruit": 3,
    "carbonation": 2,
    "alcohol": 5,
    "haze": 1
  },
  "Barleywine - English": {
    "bitterness": 3,
    "sweetness": 4,
    "roast": 1,
    "body": 5,
    "fruit": 3,
    "carbonation": 2,
    "alcohol": 5,
    "haze": 1
  },
  "Belgian Blonde": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 1,
    "body": 2,
    "fruit": 3,
    "carbonation": 4,
    "alcohol": 3,
    "haze": 1
  },
  "Belgian Dubbel": {
    "bitterness": 2,
    "sweetness": 4,
    "roast": 2,
    "body": 3,
    "fruit": 4,
    "carbonation": 3,
    "alcohol": 3,
    "haze": 1
  },
  "Belgian Strong Dark Ale": {
    "bitterness": 2,
    "sweetness": 4,
    "roast": 2,
    "body": 4,
    "fruit": 4,
    "carbonation": 3,
    "alcohol": 5,
    "haze": 1
  },
  "Belgian Tripel": {
    "bitterness": 3,
    "sweetness": 3,
    "roast": 1,
    "body": 3,
    "fruit": 4,
    "carbonation": 4,
    "alcohol": 5,
    "haze": 1
  },
  "Bitter - Extra Special / Strong (ESB)": {
    "bitterness": 3,
    "sweetness": 3,
    "roast": 1,
    "body": 3,
    "fruit": 2,
    "carbonation": 2,
    "alcohol": 3,
    "haze": 1
  },
  "Bitter - Session / Ordinary": {
    "bitterness": 2,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 2,
    "carbonation": 2,
    "alcohol": 1,
    "haze": 1
  },
  "Blonde / Golden Ale - American": {
    "bitterness": 2,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 2,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Blonde / Golden Ale - Other": {
    "bitterness": 2,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 2,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Bock - Doppelbock": {
    "bitterness": 2,
    "sweetness": 4,
    "roast": 2,
    "body": 4,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 4,
    "haze": 1
  },
  "Bock - Hell / Maibock / Lentebock": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 1,
    "body": 3,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 3,
    "haze": 1
  },
  "Bock - Single / Traditional": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 2,
    "body": 3,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 3,
    "haze": 1
  },
  "Brett Beer": {
    "bitterness": 2,
    "sweetness": 1,
    "roast": 1,
    "body": 2,
    "fruit": 3,
    "carbonation": 4,
    "alcohol": 3,
    "haze": 2
  },
  "Brown Ale - American": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 3,
    "body": 3,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 3,
    "haze": 1
  },
  "Brown Ale - Belgian": {
    "bitterness": 2,
    "sweetness": 4,
    "roast": 3,
    "body": 3,
    "fruit": 3,
    "carbonation": 3,
    "alcohol": 3,
    "haze": 1
  },
  "Brown Ale - English": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 3,
    "body": 3,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 2,
    "haze": 1
  },
  "Brown Ale - Imperial / Double": {
    "bitterness": 3,
    "sweetness": 3,
    "roast": 4,
    "body": 4,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 4,
    "haze": 1
  },
  "Brown Ale - Other": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 3,
    "body": 3,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "California Common": {
    "bitterness": 3,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Cider - Herbed / Spiced": {
    "bitterness": 1,
    "sweetness": 3,
    "roast": 1,
    "body": 2,
    "fruit": 4,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 2
  },
  "Cider - Traditional / Apfelwein": {
    "bitterness": 1,
    "sweetness": 2,
    "roast": 1,
    "body": 1,
    "fruit": 4,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Cream Ale": {
    "bitterness": 1,
    "sweetness": 2,
    "roast": 1,
    "body": 1,
    "fruit": 1,
    "carbonation": 4,
    "alcohol": 2,
    "haze": 1
  },
  "Dark Ale": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 3,
    "body": 3,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 2,
    "haze": 1
  },
  "Farmhouse Ale - Bi\u00e8re de Garde": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 2,
    "body": 3,
    "fruit": 2,
    "carbonation": 3,
    "alcohol": 3,
    "haze": 1
  },
  "Farmhouse Ale - Grisette": {
    "bitterness": 2,
    "sweetness": 1,
    "roast": 1,
    "body": 1,
    "fruit": 2,
    "carbonation": 4,
    "alcohol": 1,
    "haze": 2
  },
  "Farmhouse Ale - Saison": {
    "bitterness": 2,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 3,
    "carbonation": 4,
    "alcohol": 3,
    "haze": 2
  },
  "Festbier": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 1,
    "body": 3,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 3,
    "haze": 1
  },
  "Fruit Beer": {
    "bitterness": 1,
    "sweetness": 3,
    "roast": 1,
    "body": 2,
    "fruit": 5,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 3
  },
  "Hard Ginger Beer": {
    "bitterness": 1,
    "sweetness": 3,
    "roast": 1,
    "body": 1,
    "fruit": 2,
    "carbonation": 4,
    "alcohol": 2,
    "haze": 1
  },
  "Historical Beer - Kentucky Common": {
    "bitterness": 2,
    "sweetness": 2,
    "roast": 2,
    "body": 2,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Historical Beer - Other": {
    "bitterness": 2,
    "sweetness": 2,
    "roast": 2,
    "body": 2,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Historical Beer - Pre-Prohibition Lager": {
    "bitterness": 2,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "IPA - American": {
    "bitterness": 4,
    "sweetness": 2,
    "roast": 1,
    "body": 3,
    "fruit": 3,
    "carbonation": 3,
    "alcohol": 3,
    "haze": 1
  },
  "IPA - Australian": {
    "bitterness": 4,
    "sweetness": 2,
    "roast": 1,
    "body": 3,
    "fruit": 3,
    "carbonation": 3,
    "alcohol": 3,
    "haze": 2
  },
  "IPA - Belgian": {
    "bitterness": 4,
    "sweetness": 2,
    "roast": 1,
    "body": 3,
    "fruit": 3,
    "carbonation": 4,
    "alcohol": 4,
    "haze": 1
  },
  "IPA - Black / Cascadian Dark Ale": {
    "bitterness": 4,
    "sweetness": 1,
    "roast": 3,
    "body": 3,
    "fruit": 2,
    "carbonation": 3,
    "alcohol": 3,
    "haze": 1
  },
  "IPA - Brown": {
    "bitterness": 4,
    "sweetness": 2,
    "roast": 2,
    "body": 3,
    "fruit": 2,
    "carbonation": 3,
    "alcohol": 3,
    "haze": 1
  },
  "IPA - Cold": {
    "bitterness": 3,
    "sweetness": 1,
    "roast": 1,
    "body": 1,
    "fruit": 2,
    "carbonation": 4,
    "alcohol": 2,
    "haze": 1
  },
  "IPA - English": {
    "bitterness": 4,
    "sweetness": 2,
    "roast": 1,
    "body": 3,
    "fruit": 2,
    "carbonation": 2,
    "alcohol": 3,
    "haze": 1
  },
  "IPA - Farmhouse": {
    "bitterness": 3,
    "sweetness": 1,
    "roast": 1,
    "body": 2,
    "fruit": 3,
    "carbonation": 4,
    "alcohol": 3,
    "haze": 2
  },
  "IPA - Fruited": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 1,
    "body": 3,
    "fruit": 5,
    "carbonation": 2,
    "alcohol": 3,
    "haze": 4
  },
  "IPA - Imperial / Double": {
    "bitterness": 5,
    "sweetness": 2,
    "roast": 1,
    "body": 4,
    "fruit": 3,
    "carbonation": 3,
    "alcohol": 4,
    "haze": 1
  },
  "IPA - Imperial / Double New England / Hazy": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 1,
    "body": 4,
    "fruit": 5,
    "carbonation": 2,
    "alcohol": 4,
    "haze": 5
  },
  "IPA - Milkshake": {
    "bitterness": 1,
    "sweetness": 4,
    "roast": 1,
    "body": 4,
    "fruit": 4,
    "carbonation": 1,
    "alcohol": 3,
    "haze": 5
  },
  "IPA - New England / Hazy": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 1,
    "body": 3,
    "fruit": 5,
    "carbonation": 2,
    "alcohol": 3,
    "haze": 5
  },
  "IPA - New Zealand": {
    "bitterness": 3,
    "sweetness": 2,
    "roast": 1,
    "body": 3,
    "fruit": 4,
    "carbonation": 2,
    "alcohol": 3,
    "haze": 3
  },
  "IPA - Red": {
    "bitterness": 4,
    "sweetness": 2,
    "roast": 2,
    "body": 3,
    "fruit": 2,
    "carbonation": 3,
    "alcohol": 3,
    "haze": 1
  },
  "IPA - Rye": {
    "bitterness": 4,
    "sweetness": 2,
    "roast": 1,
    "body": 3,
    "fruit": 2,
    "carbonation": 3,
    "alcohol": 3,
    "haze": 1
  },
  "IPA - Session": {
    "bitterness": 3,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 3,
    "carbonation": 3,
    "alcohol": 1,
    "haze": 2
  },
  "IPA - Session New England / Hazy": {
    "bitterness": 1,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 4,
    "carbonation": 2,
    "alcohol": 1,
    "haze": 4
  },
  "IPA - Triple": {
    "bitterness": 5,
    "sweetness": 2,
    "roast": 1,
    "body": 4,
    "fruit": 3,
    "carbonation": 3,
    "alcohol": 5,
    "haze": 1
  },
  "IPA - Triple New England / Hazy": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 1,
    "body": 4,
    "fruit": 5,
    "carbonation": 2,
    "alcohol": 5,
    "haze": 5
  },
  "IPA - White / Wheat": {
    "bitterness": 3,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 3,
    "carbonation": 3,
    "alcohol": 3,
    "haze": 3
  },
  "Kellerbier / Zwickelbier": {
    "bitterness": 2,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 2,
    "haze": 3
  },
  "K\u00f6lsch": {
    "bitterness": 2,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 2,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Lager - Amber / Red": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 2,
    "body": 3,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Lager - American": {
    "bitterness": 1,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 1,
    "carbonation": 4,
    "alcohol": 2,
    "haze": 1
  },
  "Lager - American Amber / Red": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 2,
    "body": 2,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Lager - American Light": {
    "bitterness": 1,
    "sweetness": 1,
    "roast": 1,
    "body": 1,
    "fruit": 1,
    "carbonation": 4,
    "alcohol": 1,
    "haze": 1
  },
  "Lager - Dark": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 3,
    "body": 3,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Lager - Dortmunder / Export": {
    "bitterness": 2,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Lager - Helles": {
    "bitterness": 2,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Lager - IPL (India Pale Lager)": {
    "bitterness": 4,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 3,
    "carbonation": 3,
    "alcohol": 3,
    "haze": 1
  },
  "Lager - Japanese Rice": {
    "bitterness": 1,
    "sweetness": 1,
    "roast": 1,
    "body": 1,
    "fruit": 1,
    "carbonation": 4,
    "alcohol": 2,
    "haze": 1
  },
  "Lager - Mexican": {
    "bitterness": 1,
    "sweetness": 2,
    "roast": 1,
    "body": 1,
    "fruit": 1,
    "carbonation": 4,
    "alcohol": 2,
    "haze": 1
  },
  "Lager - Munich Dunkel": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 3,
    "body": 3,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Lager - Other": {
    "bitterness": 2,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Lager - Pale": {
    "bitterness": 2,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Lager - Smoked": {
    "bitterness": 2,
    "sweetness": 2,
    "roast": 3,
    "body": 3,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Lager - Sv\u011btl\u00e9 (Czech Pale)": {
    "bitterness": 3,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Lager - Tmav\u00e9 (Czech Dark)": {
    "bitterness": 3,
    "sweetness": 2,
    "roast": 3,
    "body": 3,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Lager - Vienna": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 2,
    "body": 3,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Lager - Winter": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 2,
    "body": 3,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 3,
    "haze": 1
  },
  "Malt Liquor": {
    "bitterness": 1,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 4,
    "haze": 1
  },
  "Mead - Braggot": {
    "bitterness": 1,
    "sweetness": 4,
    "roast": 1,
    "body": 3,
    "fruit": 3,
    "carbonation": 2,
    "alcohol": 4,
    "haze": 1
  },
  "Mild - Dark": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 2,
    "body": 2,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 1,
    "haze": 1
  },
  "Mild - Other": {
    "bitterness": 2,
    "sweetness": 2,
    "roast": 2,
    "body": 2,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 1,
    "haze": 1
  },
  "M\u00e4rzen": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 2,
    "body": 3,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 3,
    "haze": 1
  },
  "Non-Alcoholic - IPA": {
    "bitterness": 3,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 3,
    "carbonation": 3,
    "alcohol": 1,
    "haze": 2
  },
  "Non-Alcoholic - Porter / Stout": {
    "bitterness": 2,
    "sweetness": 2,
    "roast": 4,
    "body": 2,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 1,
    "haze": 1
  },
  "Other": {
    "bitterness": 2,
    "sweetness": 2,
    "roast": 2,
    "body": 2,
    "fruit": 2,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 2
  },
  "Pale Ale - American": {
    "bitterness": 3,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 2,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Pale Ale - Belgian": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 1,
    "body": 2,
    "fruit": 3,
    "carbonation": 4,
    "alcohol": 3,
    "haze": 1
  },
  "Pale Ale - English": {
    "bitterness": 3,
    "sweetness": 3,
    "roast": 1,
    "body": 2,
    "fruit": 2,
    "carbonation": 2,
    "alcohol": 2,
    "haze": 1
  },
  "Pale Ale - New England / Hazy": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 1,
    "body": 2,
    "fruit": 4,
    "carbonation": 2,
    "alcohol": 2,
    "haze": 4
  },
  "Pale Ale - Other": {
    "bitterness": 2,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 2,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 2
  },
  "Pale Ale - XPA (Extra Pale)": {
    "bitterness": 2,
    "sweetness": 2,
    "roast": 1,
    "body": 1,
    "fruit": 2,
    "carbonation": 3,
    "alcohol": 1,
    "haze": 1
  },
  "Pilsner - American": {
    "bitterness": 1,
    "sweetness": 2,
    "roast": 1,
    "body": 1,
    "fruit": 1,
    "carbonation": 4,
    "alcohol": 2,
    "haze": 1
  },
  "Pilsner - Czech / Bohemian": {
    "bitterness": 3,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Pilsner - German": {
    "bitterness": 3,
    "sweetness": 1,
    "roast": 1,
    "body": 2,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Pilsner - Imperial / Double": {
    "bitterness": 4,
    "sweetness": 2,
    "roast": 1,
    "body": 3,
    "fruit": 2,
    "carbonation": 3,
    "alcohol": 4,
    "haze": 1
  },
  "Pilsner - Italian": {
    "bitterness": 2,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Pilsner - New Zealand": {
    "bitterness": 2,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 3,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Pilsner - Other": {
    "bitterness": 2,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Porter - American": {
    "bitterness": 3,
    "sweetness": 2,
    "roast": 4,
    "body": 3,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 3,
    "haze": 1
  },
  "Porter - Baltic": {
    "bitterness": 3,
    "sweetness": 3,
    "roast": 4,
    "body": 4,
    "fruit": 2,
    "carbonation": 2,
    "alcohol": 4,
    "haze": 1
  },
  "Porter - Coffee": {
    "bitterness": 3,
    "sweetness": 2,
    "roast": 4,
    "body": 4,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 3,
    "haze": 1
  },
  "Porter - English": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 3,
    "body": 3,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 2,
    "haze": 1
  },
  "Porter - Imperial / Double": {
    "bitterness": 3,
    "sweetness": 3,
    "roast": 4,
    "body": 5,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 5,
    "haze": 1
  },
  "Porter - Imperial / Double Coffee": {
    "bitterness": 3,
    "sweetness": 3,
    "roast": 5,
    "body": 5,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 5,
    "haze": 1
  },
  "Porter - Other": {
    "bitterness": 3,
    "sweetness": 2,
    "roast": 3,
    "body": 3,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 3,
    "haze": 1
  },
  "Porter - Smoked": {
    "bitterness": 2,
    "sweetness": 2,
    "roast": 4,
    "body": 3,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 3,
    "haze": 1
  },
  "Pumpkin / Yam Beer": {
    "bitterness": 1,
    "sweetness": 4,
    "roast": 2,
    "body": 3,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 3,
    "haze": 1
  },
  "Red Ale - American Amber / Red": {
    "bitterness": 3,
    "sweetness": 3,
    "roast": 2,
    "body": 3,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 3,
    "haze": 1
  },
  "Red Ale - Imperial / Double": {
    "bitterness": 3,
    "sweetness": 3,
    "roast": 2,
    "body": 4,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 4,
    "haze": 1
  },
  "Red Ale - Irish": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 2,
    "body": 3,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Red Ale - Other": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 2,
    "body": 3,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Root Beer": {
    "bitterness": 1,
    "sweetness": 5,
    "roast": 1,
    "body": 2,
    "fruit": 1,
    "carbonation": 4,
    "alcohol": 1,
    "haze": 1
  },
  "Rye Beer": {
    "bitterness": 3,
    "sweetness": 2,
    "roast": 1,
    "body": 3,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Schwarzbier": {
    "bitterness": 3,
    "sweetness": 2,
    "roast": 3,
    "body": 2,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Scotch Ale / Wee Heavy": {
    "bitterness": 2,
    "sweetness": 4,
    "roast": 3,
    "body": 4,
    "fruit": 2,
    "carbonation": 2,
    "alcohol": 4,
    "haze": 1
  },
  "Scottish Ale": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 2,
    "body": 3,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 2,
    "haze": 1
  },
  "Scottish Export Ale": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 2,
    "body": 3,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 2,
    "haze": 1
  },
  "Shandy / Radler": {
    "bitterness": 1,
    "sweetness": 4,
    "roast": 1,
    "body": 1,
    "fruit": 4,
    "carbonation": 4,
    "alcohol": 1,
    "haze": 1
  },
  "Smoked Beer": {
    "bitterness": 2,
    "sweetness": 2,
    "roast": 3,
    "body": 3,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Sour - Berliner Weisse": {
    "bitterness": 1,
    "sweetness": 1,
    "roast": 1,
    "body": 1,
    "fruit": 2,
    "carbonation": 4,
    "alcohol": 1,
    "haze": 2
  },
  "Sour - Flanders Red Ale": {
    "bitterness": 1,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 4,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Sour - Fruited": {
    "bitterness": 1,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 5,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 2
  },
  "Sour - Fruited Berliner Weisse": {
    "bitterness": 1,
    "sweetness": 2,
    "roast": 1,
    "body": 1,
    "fruit": 5,
    "carbonation": 4,
    "alcohol": 1,
    "haze": 2
  },
  "Sour - Fruited Gose": {
    "bitterness": 1,
    "sweetness": 2,
    "roast": 1,
    "body": 1,
    "fruit": 5,
    "carbonation": 4,
    "alcohol": 1,
    "haze": 2
  },
  "Sour - Other": {
    "bitterness": 1,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 3,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 2
  },
  "Sour - Other Gose": {
    "bitterness": 1,
    "sweetness": 1,
    "roast": 1,
    "body": 1,
    "fruit": 2,
    "carbonation": 4,
    "alcohol": 1,
    "haze": 2
  },
  "Sour - Tomato / Vegetable Gose": {
    "bitterness": 1,
    "sweetness": 1,
    "roast": 1,
    "body": 1,
    "fruit": 2,
    "carbonation": 4,
    "alcohol": 1,
    "haze": 3
  },
  "Sour - Traditional Gose": {
    "bitterness": 1,
    "sweetness": 1,
    "roast": 1,
    "body": 1,
    "fruit": 1,
    "carbonation": 4,
    "alcohol": 1,
    "haze": 2
  },
  "Spiced / Herbed Beer": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 1,
    "body": 2,
    "fruit": 2,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 2
  },
  "Stout - American": {
    "bitterness": 3,
    "sweetness": 2,
    "roast": 4,
    "body": 4,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 3,
    "haze": 1
  },
  "Stout - Coffee": {
    "bitterness": 3,
    "sweetness": 2,
    "roast": 4,
    "body": 4,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 3,
    "haze": 1
  },
  "Stout - Foreign / Export": {
    "bitterness": 3,
    "sweetness": 2,
    "roast": 4,
    "body": 4,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 3,
    "haze": 1
  },
  "Stout - Imperial / Double": {
    "bitterness": 4,
    "sweetness": 2,
    "roast": 5,
    "body": 5,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 5,
    "haze": 1
  },
  "Stout - Imperial / Double Coffee": {
    "bitterness": 4,
    "sweetness": 3,
    "roast": 5,
    "body": 5,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 5,
    "haze": 1
  },
  "Stout - Imperial / Double Milk": {
    "bitterness": 3,
    "sweetness": 5,
    "roast": 4,
    "body": 5,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 5,
    "haze": 1
  },
  "Stout - Imperial / Double Pastry": {
    "bitterness": 2,
    "sweetness": 5,
    "roast": 4,
    "body": 5,
    "fruit": 2,
    "carbonation": 1,
    "alcohol": 5,
    "haze": 1
  },
  "Stout - Irish Dry": {
    "bitterness": 3,
    "sweetness": 1,
    "roast": 4,
    "body": 3,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 2,
    "haze": 1
  },
  "Stout - Milk / Sweet": {
    "bitterness": 2,
    "sweetness": 4,
    "roast": 3,
    "body": 4,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 3,
    "haze": 1
  },
  "Stout - Oatmeal": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 3,
    "body": 4,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 3,
    "haze": 1
  },
  "Stout - Other": {
    "bitterness": 3,
    "sweetness": 2,
    "roast": 4,
    "body": 4,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 3,
    "haze": 1
  },
  "Stout - Russian Imperial": {
    "bitterness": 4,
    "sweetness": 2,
    "roast": 5,
    "body": 5,
    "fruit": 1,
    "carbonation": 2,
    "alcohol": 5,
    "haze": 1
  },
  "Stout - White / Golden": {
    "bitterness": 2,
    "sweetness": 3,
    "roast": 1,
    "body": 3,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 4,
    "haze": 2
  },
  "Strong Ale - American": {
    "bitterness": 3,
    "sweetness": 3,
    "roast": 2,
    "body": 4,
    "fruit": 2,
    "carbonation": 2,
    "alcohol": 4,
    "haze": 1
  },
  "Table Beer": {
    "bitterness": 1,
    "sweetness": 1,
    "roast": 1,
    "body": 1,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 1,
    "haze": 1
  },
  "Traditional Ale": {
    "bitterness": 2,
    "sweetness": 2,
    "roast": 2,
    "body": 2,
    "fruit": 1,
    "carbonation": 3,
    "alcohol": 2,
    "haze": 1
  },
  "Wheat Beer - American Pale Wheat": {
    "bitterness": 1,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 2,
    "carbonation": 4,
    "alcohol": 2,
    "haze": 3
  },
  "Wheat Beer - Dunkelweizen": {
    "bitterness": 1,
    "sweetness": 3,
    "roast": 2,
    "body": 3,
    "fruit": 3,
    "carbonation": 4,
    "alcohol": 2,
    "haze": 4
  },
  "Wheat Beer - Hefeweizen": {
    "bitterness": 1,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 3,
    "carbonation": 4,
    "alcohol": 2,
    "haze": 4
  },
  "Wheat Beer - Kristallweizen": {
    "bitterness": 1,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 3,
    "carbonation": 4,
    "alcohol": 2,
    "haze": 1
  },
  "Wheat Beer - Other": {
    "bitterness": 1,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 2,
    "carbonation": 4,
    "alcohol": 2,
    "haze": 3
  },
  "Wheat Beer - Wheat Wine": {
    "bitterness": 3,
    "sweetness": 3,
    "roast": 1,
    "body": 5,
    "fruit": 2,
    "carbonation": 2,
    "alcohol": 5,
    "haze": 2
  },
  "Wheat Beer - Witbier / Blanche": {
    "bitterness": 1,
    "sweetness": 2,
    "roast": 1,
    "body": 2,
    "fruit": 3,
    "carbonation": 4,
    "alcohol": 2,
    "haze": 3
  },
  "Wild Ale - American": {
    "bitterness": 2,
    "sweetness": 1,
    "roast": 1,
    "body": 2,
    "fruit": 3,
    "carbonation": 3,
    "alcohol": 3,
    "haze": 2
  },
  "Winter Ale": {
    "bitterness": 2,
    "sweetness": 4,
    "roast": 2,
    "body": 4,
    "fruit": 2,
    "carbonation": 2,
    "alcohol": 4,
    "haze": 1
  },
  "Winter Warmer": {
    "bitterness": 2,
    "sweetness": 4,
    "roast": 2,
    "body": 4,
    "fruit": 2,
    "carbonation": 2,
    "alcohol": 4,
    "haze": 1
  }
};

if (typeof module !== 'undefined') {
  module.exports = STYLE_MATRIX;
}

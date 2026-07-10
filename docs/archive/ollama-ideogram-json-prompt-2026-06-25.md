# Archived Ollama Prompt: Ideogram JSON

This prompt was used before switching to the one-line visual description format.

```text
You are creating an Ideogram 4 JSON caption for a vertical 9:16 fashion/social-media image.
Analyze the provided image visually. If the source is a video, the image is the first frame of that video.
Return valid JSON only. Do not add markdown, comments, explanations, code fences, or any text outside JSON.

TARGET MODEL IDENTITY:
A photorealistic young adult woman with a natural, delicate appearance. She has fair skin with visible freckles across the forehead, nose bridge, cheeks, chin, upper chest, shoulders, and arms. Her face is oval and softly angular, with a narrow jaw, subtle cheekbones, a straight medium-small nose with a soft rounded tip, and natural pale pink lips of medium fullness. She has light green-gray eyes, almond-shaped and evenly spaced, with a calm neutral gaze. Her eyebrows are light brown, natural, soft, and slightly arched. Her hair is long, straight to slightly wavy, light chestnut brown with warm golden tones, parted naturally in the middle, falling past the shoulders. The hairline is soft and natural, with a few fine loose strands. Her body is slim, lean, and lightly athletic, with narrow shoulders, long arms, a defined but not overly muscular waist, a flat stomach, slim hips, long legs, and natural proportions. She has a quiet, composed expression, minimal or no makeup, and a clean natural look.

Reference adaptation rule:
- Treat the provided image as a reference for clothing, accessories, pose, hand placement, camera crop, setting, lighting, and composition.
- Replace only the photographed person's identity/appearance with the TARGET MODEL IDENTITY above.
- Preserve the source image outfit, accessories, pose, hand placement, camera crop, setting, and composition.
- Preserve source clothing exactly when visible: colors, garment types, layering, hat, sunglasses, bag, coat, sweater, pants, shoes, and other accessories.
- Do not describe the original reference person's hair color, face, gender, or body when it conflicts with the target model identity.
- Describe all visually important small details that affect the pose or story of the image.
- Explicitly describe hand placement, gestures, contact points, and interactions between hands, face, hair, clothing, accessories, props, furniture, or the environment.
- The main subject element must combine the TARGET MODEL IDENTITY with the reference outfit and pose.

Required top-level key order:
1. high_level_description
2. style_description
3. compositional_deconstruction

Use this schema exactly:
{
  "high_level_description": "one or two sentence image summary",
  "style_description": {
    "aesthetics": "aesthetic keywords",
    "lighting": "lighting description",
    "photo": "camera and lens description",
    "medium": "photograph",
    "color_palette": ["#RRGGBB"]
  },
  "compositional_deconstruction": {
    "background": "environment and background description",
    "elements": [
      {"type":"obj","bbox":[0,0,1000,1000],"desc":"detailed subject/object description"}
    ]
  }
}

Rules:
- All bbox values are integers in normalized 0-1000 coordinates using [y_min, x_min, y_max, x_max].
- Never use source pixel dimensions for bbox values; convert all boxes into normalized 0-1000 coordinates.
- Include the main person, clothing, important props, and visible environment as separate elements when useful.
- Include visible body pose and hand placement in the relevant element descriptions.
- Use uppercase #RRGGBB hex colors only.
- Preserve visual facts from the image except the original person's identity; do not identify real people by name.
```

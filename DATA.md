# Dataset access

## Product decision

**Cues should be real radiologist wording** (finding sentences from reports), not bare labels. The loop is language → pixels.

## Current default: X-Raydar (non-commercial)

[X-Raydar multimodal](https://huggingface.co/datasets/dnamodel/xraydar-multimodal) (~979 exams): real UK radiology reports + finding boxes. Terms: academic / non-commercial until you license otherwise. Fine for building and trainee validation.

```bash
# annotations already at data/raw/xraydar/annotations.jsonl
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY all_proxy
python3 scripts/build-drills.py --xraydar --limit 60 --min-cue-score 2
```

That downloads only the images for the sampled drills, writes JPEGs under `public/drills/`, and refreshes `public/drills.json`. Raw PNGs can be deleted after to save disk.

## Other options

| Source | Gate | Cue quality |
| --- | --- | --- |
| **MS-CXR** | PhysioNet + CITI | Phrase↔box pairs |
| **PadChest-GR** | Research request; sample off-machine | Grounded report sentences |
| **ChestX-Det** | None | Label templates only (mechanic stand-in) |

```bash
python3 scripts/build-drills.py --chestxdet --limit 120
```

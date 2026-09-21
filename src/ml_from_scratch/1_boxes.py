def iou(box_a: list[int], box_b: list[int]):
    """box_a, box_b: array-like [x1, y1, x2, y2]. Devuelve float."""
    dy = min(box_b[3], box_a[3])-max(box_b[1], box_a[1])
    dx = min(box_b[2], box_a[2])-max(box_b[0], box_a[0])
    A1 = (box_a[2]-box_a[0])*(box_a[3]-box_a[1])
    A2 = (box_b[2]-box_b[0])*(box_b[3]-box_b[1])

    inter = dy*dx  if dx>0 and dy>0 else 0
    union = (A1-inter)+A2
    return inter/union if union != 0 else 0 

     
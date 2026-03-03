"""
Layout Processor - Advanced document layout analysis and structure detection
Detects and preserves document structure: headers, titles, paragraphs, lists, tables, etc.
"""

import re
from typing import List, Dict, Tuple, Optional, Any
from dataclasses import dataclass


@dataclass
class TextBlock:
    """Represents a text block with position and formatting"""
    text: str
    bbox: List[float]  # [x0, y0, x1, y1]
    confidence: float = 1.0
    alignment: Optional[str] = None
    indent: float = 0.0
    font_size: Optional[float] = None
    is_bold: bool = False
    is_italic: bool = False


@dataclass
class LayoutElement:
    """Represents a layout element with type and content"""
    element_type: str  # title, header, paragraph, list_item, table, etc.
    text: str
    bbox: List[float]
    level: int = 0  # For hierarchical structures (heading levels)
    metadata: Dict[str, Any] = None


class LayoutProcessor:
    """
    Advanced layout processor for document structure detection
    - Detects headers, titles, paragraphs, lists
    - Handles multi-column layouts
    - Preserves reading order
    - Recognizes legal document structures (Điều, Khoản, Điểm)
    """
    
    def __init__(self):
        # Legal document patterns (Vietnamese)
        self.legal_patterns = {
            'quoc_hieu': r'^(CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM|CHÍNH PHỦ|BỘ|UBND)',
            'title': r'^(NGHỊ ĐỊNH|LUẬT|QUYẾT ĐỊNH|THÔNG TƯ|CHỈ THỊ)',
            'dieu': r'^Điều\s+(\d+)\.',
            'khoan': r'^(\d+)\.\s+',
            'diem': r'^([a-zđêôơư])\)\s+',
            'chu': r'^([A-ZĐÊÔƠƯ])\.\s+',
        }
        
        # Common header patterns
        self.header_patterns = [
            r'^CHƯƠNG\s+\d+',
            r'^PHẦN\s+\d+',
            r'^MỤC\s+\d+',
        ]
    
    def detect_block_type(self, block: TextBlock, page_width: float, page_height: float) -> str:
        """
        Detect the type of a text block based on content and position
        
        Returns:
            str: Block type (title, header, heading1, heading2, list_item, paragraph, text)
        """
        text = block.text.strip()
        if not text:
            return "text"
        
        bbox = block.bbox
        bbox_width = bbox[2] - bbox[0] if len(bbox) >= 4 else 0
        bbox_height = bbox[3] - bbox[1] if len(bbox) >= 4 else 0
        
        rel_width = bbox_width / page_width if page_width > 0 else 0
        rel_height = bbox_height / page_height if page_height > 0 else 0
        center_y = (bbox[1] + bbox[3]) / 2 if len(bbox) >= 4 else 0
        rel_y = center_y / page_height if page_height > 0 else 0
        
        # 1. Check legal document patterns
        # Quốc hiệu / Header
        if re.match(self.legal_patterns['quoc_hieu'], text, re.IGNORECASE):
            return "header"
        
        # Title (NGHỊ ĐỊNH, LUẬT, etc.)
        if re.match(self.legal_patterns['title'], text, re.IGNORECASE):
            return "title"
        
        # Điều (Article)
        if re.match(self.legal_patterns['dieu'], text, re.IGNORECASE):
            return "heading1"
        
        # Khoản (Clause) - số + dấu chấm
        if re.match(self.legal_patterns['khoan'], text):
            return "heading2"
        
        # Điểm (Point) - chữ cái + dấu ngoặc
        if re.match(self.legal_patterns['diem'], text, re.IGNORECASE):
            return "list_item"
        
        # Chữ (Letter) - chữ hoa + dấu chấm
        if re.match(self.legal_patterns['chu'], text):
            return "list_item"
        
        # 2. Check common header patterns
        for pattern in self.header_patterns:
            if re.match(pattern, text, re.IGNORECASE):
                return "header"
        
        # 3. Position-based detection
        # Title detection (top of page, centered, short text)
        if (rel_y < 0.15 and  # Top 15% of page
            (rel_width > 0.7 or block.alignment == "center") and  # Wide or centered
            len(text) < 100 and  # Short text
            (text.isupper() or block.is_bold)):
            return "title"
        
        # Header detection (top 25% of page, medium length)
        if (rel_y < 0.25 and  # Top 25% of page
            len(text) > 20 and len(text) < 200 and  # Medium length
            (text.isupper() or text[0].isupper() or block.is_bold)):
            return "header"
        
        # 4. Format-based detection
        # Bold and large = likely heading
        if block.is_bold and block.font_size and block.font_size > 12:
            if len(text) < 100:
                return "heading1"
        
        # 5. List detection
        # Numbered list (1., 2., 3., etc.)
        if re.match(r'^\d+[\.\)]\s+', text):
            return "list_item"
        
        # Bullet list (-, •, etc.)
        if re.match(r'^[-\•\*]\s+', text):
            return "list_item"
        
        # 6. Paragraph detection
        # Long text, medium width = paragraph
        if len(text) > 200 and 0.4 < rel_width < 0.95:
            return "paragraph"
        
        # Default: regular text
        return "text"
    
    def detect_columns(self, blocks: List[TextBlock], page_width: float) -> List[List[TextBlock]]:
        """
        Detect multi-column layout and group blocks by column
        
        Returns:
            List of columns, each column is a list of TextBlocks
        """
        if not blocks:
            return []
        
        # Sort blocks by y-coordinate (top to bottom)
        sorted_blocks = sorted(blocks, key=lambda b: b.bbox[1] if len(b.bbox) >= 2 else 0)
        
        columns = []
        column_threshold = page_width * 0.3  # 30% of page width
        
        for block in sorted_blocks:
            if len(block.bbox) < 4:
                continue
            
            bbox = block.bbox
            center_x = (bbox[0] + bbox[2]) / 2
            
            # Try to match with existing column
            matched = False
            for col in columns:
                if col:
                    # Calculate column center
                    col_centers = [
                        (b.bbox[0] + b.bbox[2]) / 2
                        for b in col
                        if len(b.bbox) >= 4
                    ]
                    if col_centers:
                        col_center_x = sum(col_centers) / len(col_centers)
                        if abs(center_x - col_center_x) < column_threshold:
                            col.append(block)
                            matched = True
                            break
            
            # Create new column if no match
            if not matched:
                columns.append([block])
        
        # Sort columns by x-coordinate (left to right)
        columns.sort(key=lambda col: (
            sum((b.bbox[0] + b.bbox[2]) / 2 for b in col if len(b.bbox) >= 4) / len(col)
            if col else 0
        ))
        
        return columns
    
    def detect_reading_order(self, blocks: List[TextBlock], page_width: float, page_height: float) -> List[TextBlock]:
        """
        Detect reading order for blocks (top-to-bottom, left-to-right, column-aware)
        
        Returns:
            List of TextBlocks in reading order
        """
        if not blocks:
            return []
        
        # Detect columns
        columns = self.detect_columns(blocks, page_width)
        
        # Single column: simple top-to-bottom sort
        if len(columns) <= 1:
            return sorted(blocks, key=lambda b: (
                b.bbox[1] if len(b.bbox) >= 2 else 0,
                b.bbox[0] if len(b.bbox) >= 1 else 0
            ))
        
        # Multi-column: process column by column, strip by strip
        ordered_blocks = []
        max_col_length = max(len(col) for col in columns) if columns else 0
        
        # Process in horizontal strips
        for strip_idx in range(max_col_length):
            for col in columns:
                if strip_idx < len(col):
                    strip_blocks = [col[strip_idx]]
                    block = col[strip_idx]
                    
                    if len(block.bbox) >= 4:
                        y_center = (block.bbox[1] + block.bbox[3]) / 2
                        y_tolerance = page_height * 0.05  # 5% tolerance
                        
                        # Find blocks in other columns at similar y-level
                        for other_col in columns:
                            if other_col != col:
                                for other_block in other_col:
                                    if len(other_block.bbox) >= 4:
                                        other_y_center = (other_block.bbox[1] + other_block.bbox[3]) / 2
                                        if abs(other_y_center - y_center) < y_tolerance:
                                            if other_block not in strip_blocks:
                                                strip_blocks.append(other_block)
                        
                        # Sort strip blocks left to right
                        strip_blocks.sort(key=lambda b: b.bbox[0] if len(b.bbox) >= 1 else 0)
                        ordered_blocks.extend(strip_blocks)
        
        return ordered_blocks
    
    def group_into_paragraphs(self, blocks: List[TextBlock], page_height: float) -> List[List[TextBlock]]:
        """
        Group text blocks into paragraphs based on spacing and formatting
        
        Returns:
            List of paragraphs, each paragraph is a list of TextBlocks
        """
        if not blocks:
            return []
        
        paragraphs = []
        current_para = []
        last_y = None
        last_alignment = None
        last_indent = None
        
        for block in blocks:
            if len(block.bbox) < 4:
                continue
            
            y0 = block.bbox[1]
            alignment = block.alignment
            indent = block.indent
            
            # Determine if new paragraph
            new_para = False
            if last_y is not None:
                vertical_gap = y0 - last_y
                alignment_changed = alignment != last_alignment
                indent_changed = abs(indent - (last_indent or 0)) > 0.5  # 0.5 points
                
                # Large vertical gap (>30px or >3% of page height)
                if vertical_gap > max(30, page_height * 0.03):
                    new_para = True
                # Alignment or indent changed significantly
                elif alignment_changed or indent_changed:
                    new_para = True
            
            # Start new paragraph
            if new_para and current_para:
                paragraphs.append(current_para)
                current_para = []
            
            current_para.append(block)
            last_y = block.bbox[3] if len(block.bbox) >= 4 else y0
            last_alignment = alignment
            last_indent = indent
        
        # Add remaining paragraph
        if current_para:
            paragraphs.append(current_para)
        
        return paragraphs
    
    def process_layout(
        self,
        blocks: List[TextBlock],
        page_width: float,
        page_height: float
    ) -> List[LayoutElement]:
        """
        Process layout: detect structure, reading order, and group into elements
        
        Returns:
            List of LayoutElements with detected structure
        """
        if not blocks:
            return []
        
        # 1. Detect reading order
        ordered_blocks = self.detect_reading_order(blocks, page_width, page_height)
        
        # 2. Group into paragraphs
        paragraphs = self.group_into_paragraphs(ordered_blocks, page_height)
        
        # 3. Create layout elements
        layout_elements = []
        
        for para_blocks in paragraphs:
            if not para_blocks:
                continue
            
            # Get paragraph text
            para_text = ' '.join(b.text for b in para_blocks if b.text.strip())
            
            if not para_text.strip():
                continue
            
            # Get bounding box (union of all blocks)
            x0 = min(b.bbox[0] for b in para_blocks if len(b.bbox) >= 1)
            y0 = min(b.bbox[1] for b in para_blocks if len(b.bbox) >= 2)
            x1 = max(b.bbox[2] for b in para_blocks if len(b.bbox) >= 3)
            y1 = max(b.bbox[3] for b in para_blocks if len(b.bbox) >= 4)
            bbox = [x0, y0, x1, y1]
            
            # Detect element type from first block
            first_block = para_blocks[0]
            element_type = self.detect_block_type(first_block, page_width, page_height)
            
            # Extract metadata
            metadata = {
                'alignment': first_block.alignment,
                'indent': first_block.indent,
                'font_size': first_block.font_size,
                'is_bold': first_block.is_bold,
                'is_italic': first_block.is_italic,
                'confidence': min(b.confidence for b in para_blocks),
                'num_blocks': len(para_blocks)
            }
            
            # Determine level for hierarchical structures
            level = 0
            if element_type == "heading1":
                level = 1
            elif element_type == "heading2":
                level = 2
            elif element_type == "list_item":
                level = 3
            
            layout_elements.append(LayoutElement(
                element_type=element_type,
                text=para_text,
                bbox=bbox,
                level=level,
                metadata=metadata
            ))
        
        return layout_elements

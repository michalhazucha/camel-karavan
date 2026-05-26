<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
                xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
 
  <!-- Pretty-print output (optional) -->
  <xsl:output method="xml" indent="yes"/>
  <!-- Remove insignificant whitespace in element-only content (optional) -->
  <xsl:strip-space elements="*"/>
 
  <!-- Identity template -->
  <xsl:template match="@*|node()">
    <xsl:copy>
      <xsl:apply-templates select="@*|node()"/>
    </xsl:copy>
  </xsl:template>
 
</xsl:stylesheet>
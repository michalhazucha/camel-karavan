<?xml version="1.0" encoding="UTF-8"?>
<pfx:FetchESimProfileStatusResponse xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:pfx="http://www.sk.o2.com/EAI/ResourceMgmt/SimDB/1.0" xmlns:pd="http://xmlns.tibco.com/bw/process/2003" xmlns:pfx2="http://www.sk.o2.com/EAI/Service/Base" xmlns:ns="http://www.sk.o2.com/EAI/Service/Technical/ErrorHandling/1.0" xmlns:BW="java://com.tibco.pe.core.JavaCustomXPATHFunctions" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:tib="http://www.tibco.com/bw/xslt/custom-functions" xmlns:ns2="http://www.sk.o2.com/EAI/BE/Resource/1.0" xmlns:ns1="http://www.tibco.com/pe/EngineTypes" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<pfx2:messageId>
<xsl:copy-of select="$fetchESimProfileStatusCore/pfx:FetchESimProfileStatusResponse/pfx2:messageId/@xsi:nil"/>
<xsl:value-of select="$fetchESimProfileStatusCore/pfx:FetchESimProfileStatusResponse/pfx2:messageId"/>
</pfx2:messageId>
<pfx2:transactionId>
<xsl:copy-of select="$fetchESimProfileStatusCore/pfx:FetchESimProfileStatusResponse/pfx2:transactionId/@xsi:nil"/>
<xsl:value-of select="$fetchESimProfileStatusCore/pfx:FetchESimProfileStatusResponse/pfx2:transactionId"/>
</pfx2:transactionId>
<xsl:if test="$fetchESimProfileStatusCore/pfx:FetchESimProfileStatusResponse/pfx2:timestamp">
<pfx2:timestamp>
<xsl:copy-of select="$fetchESimProfileStatusCore/pfx:FetchESimProfileStatusResponse/pfx2:timestamp/@xsi:nil"/>
<xsl:value-of select="$fetchESimProfileStatusCore/pfx:FetchESimProfileStatusResponse/pfx2:timestamp"/>
</pfx2:timestamp>
</xsl:if>
<xsl:if test="$fetchESimProfileStatusCore/pfx:FetchESimProfileStatusResponse/pfx2:protocolRevision">
<pfx2:protocolRevision>
<xsl:copy-of select="$fetchESimProfileStatusCore/pfx:FetchESimProfileStatusResponse/pfx2:protocolRevision/@xsi:nil"/>
<xsl:value-of select="$fetchESimProfileStatusCore/pfx:FetchESimProfileStatusResponse/pfx2:protocolRevision"/>
</pfx2:protocolRevision>
</xsl:if>
<pfx2:requestorDN>
<xsl:copy-of select="$fetchESimProfileStatusCore/pfx:FetchESimProfileStatusResponse/pfx2:requestorDN/@xsi:nil"/>
<xsl:value-of select="$fetchESimProfileStatusCore/pfx:FetchESimProfileStatusResponse/pfx2:requestorDN"/>
</pfx2:requestorDN>
<xsl:if test="$fetchESimProfileStatusCore/pfx:FetchESimProfileStatusResponse/pfx2:correlationId">
<pfx2:correlationId>
<xsl:copy-of select="$fetchESimProfileStatusCore/pfx:FetchESimProfileStatusResponse/pfx2:correlationId/@xsi:nil"/>
<xsl:value-of select="$fetchESimProfileStatusCore/pfx:FetchESimProfileStatusResponse/pfx2:correlationId"/>
</pfx2:correlationId>
</xsl:if>
<pfx:value>
<ns2:activationCode>Omitted for logging</ns2:activationCode>
<xsl:if test="$fetchESimProfileStatusCore/pfx:FetchESimProfileStatusResponse/pfx:value/ns2:smdpAddres">
<ns2:smdpAddres>
<xsl:copy-of select="$fetchESimProfileStatusCore/pfx:FetchESimProfileStatusResponse/pfx:value/ns2:smdpAddres/@xsi:nil"/>
<xsl:value-of select="$fetchESimProfileStatusCore/pfx:FetchESimProfileStatusResponse/pfx:value/ns2:smdpAddres"/>
</ns2:smdpAddres>
</xsl:if>
<ns2:qrImage>Omitted for logging</ns2:qrImage>
<ns2:status>
<xsl:copy-of select="$fetchESimProfileStatusCore/pfx:FetchESimProfileStatusResponse/pfx:value/ns2:status/@xsi:nil"/>
<xsl:value-of select="$fetchESimProfileStatusCore/pfx:FetchESimProfileStatusResponse/pfx:value/ns2:status"/>
</ns2:status>
</pfx:value>
</pfx:FetchESimProfileStatusResponse>
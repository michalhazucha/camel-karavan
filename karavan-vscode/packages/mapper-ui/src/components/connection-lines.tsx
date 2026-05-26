"use client"

import useIsMobile from "@/lib/hooks/useIsMobile"
import type { IMappingConnection } from "@/lib/types"
import type React from "react"

import { useEffect, useState } from "react"

interface ConnectionLinesProps {
  connections: IMappingConnection[]
  containerRef: React.RefObject<HTMLDivElement | null>
  getConnectionColor?: (connectionId: string) => string
}

interface LineCoordinates {
  x1: number
  y1: number
  x2: number
  y2: number
  id: string
  color: string
}

export function ConnectionLines({ connections, containerRef, getConnectionColor }: ConnectionLinesProps) {
  const [lines, setLines] = useState<LineCoordinates[]>([])
  const { isMobile } = useIsMobile();


  // Default color palette if no getter provided
  // const defaultColors = [
  //   'orange', 'blue', 'red', 'green', 'purple',
  //   'pink', 'yellow', 'cyan', 'indigo', 'teal'
  // ]

  const oklchColors = [
    'oklch(0.637 0.237 25.331)',  // red-500
    'oklch(0.705 0.213 47.604)',  // orange-500
    'oklch(0.769 0.188 70.08)',   // amber-500
    'oklch(0.795 0.184 86.047)',  // yellow-500
    'oklch(0.768 0.233 130.85)',  // lime-500
    'oklch(0.723 0.219 149.579)', // green-500
    'oklch(0.696 0.17 162.48)',   // emerald-500
    'oklch(0.704 0.14 182.503)',  // teal-500
    'oklch(0.715 0.143 215.221)', // cyan-500
    'oklch(0.685 0.169 237.323)', // sky-500
    'oklch(0.623 0.214 259.815)', // blue-500
    'oklch(0.585 0.233 277.117)', // indigo-500
    'oklch(0.606 0.25 292.717)',  // violet-500
    'oklch(0.627 0.265 303.9)',   // purple-500
    'oklch(0.667 0.295 322.15)',  // fuchsia-500
    'oklch(0.656 0.241 354.308)', // pink-500
    'oklch(0.645 0.246 16.439)',  // rose-500
    'oklch(0.554 0.046 257.417)', // slate-500
    'oklch(0.551 0.027 264.364)', // gray-500
    'oklch(0.552 0.016 285.938)', // zinc-500
    'oklch(0.556 0 0)',           // neutral-500
    'oklch(0.553 0.013 58.071)',  // stone-500
  ]

  const getColor = (connId: string): string => {
    if (getConnectionColor) {
      return getConnectionColor(connId)
    }
    // const index = connections.findIndex(c => c.id === connId)
    return oklchColors[oklchColors.length]
  }

  useEffect(() => {
    const updateLines = () => {
      if (!containerRef.current) return

      const container = containerRef.current
      const containerRect = container.getBoundingClientRect()
      
      const newLines: LineCoordinates[] = []

      connections.forEach((conn) => {
        const sourceElement = container.querySelector(`[data-node-id="${conn.sourceId}"][data-side="source"]`)
        const targetElement = container.querySelector(`[data-node-id="${conn.targetId}"][data-side="target"]`)
        
        if (!sourceElement || !targetElement) {
          console.log('[ConnectionLines] Missing element for connection:', {
            connId: conn.id,
            sourceId: conn.sourceId,
            targetId: conn.targetId,
            sourcePath: conn.sourcePath,
            targetPath: conn.targetPath,
            sourceFound: !!sourceElement,
            targetFound: !!targetElement
          })
        }
        
        if (sourceElement && targetElement) {
          const sourceRect = sourceElement.getBoundingClientRect()
          const targetRect = targetElement.getBoundingClientRect()
          
          const sourceCard = sourceElement.closest('.overflow-auto') || sourceElement.closest('.overflow-y-auto')
          const targetCard = targetElement.closest('.overflow-auto') || targetElement.closest('.overflow-y-auto')

          if (!isMobile) {
            if (sourceCard && targetCard) {
              const sourceCardRect = sourceCard.getBoundingClientRect()
              const targetCardRect = targetCard.getBoundingClientRect()

              // Clamp Y coordinates to stay within their respective list bounds
              const y1 = Math.max(
                sourceCardRect.top - containerRect.top,
                Math.min(
                  sourceRect.top + sourceRect.height / 2 - containerRect.top,
                  sourceCardRect.bottom - containerRect.top
                )
              )
              const y2 = Math.max(
                targetCardRect.top - containerRect.top,
                Math.min(
                  targetRect.top + targetRect.height / 2 - containerRect.top,
                  targetCardRect.bottom - containerRect.top
                )
              )

              newLines.push({
                id: conn.id,
                x1: sourceRect.right - containerRect.left,
                y1,
                x2: targetRect.left - containerRect.left,
                y2,
                color: getColor(conn.id),
              })
            }
          }
          else {
            if (sourceCard && targetCard) {
              const sourceCardRect = sourceCard.getBoundingClientRect()
              const targetCardRect = targetCard.getBoundingClientRect()

              // Check if screen is smaller than md breakpoint (768px)
              const isSmallScreen = window.innerWidth < 768

              // On small screens: both connect from left (beginning)
              // On larger screens: source from right, target from left
              const x1 = isSmallScreen
                ? sourceRect.left - containerRect.left
                : Math.min(sourceRect.right, sourceCardRect.right) - containerRect.left
              const x2 = targetRect.left - containerRect.left

              // Clamp Y coordinates to stay within their respective list bounds
              const y1 = Math.max(
                sourceCardRect.top - containerRect.top,
                Math.min(
                  sourceRect.top + sourceRect.height / 2 - containerRect.top,
                  sourceCardRect.bottom - containerRect.top
                )
              )
              const y2 = Math.max(
                targetCardRect.top - containerRect.top,
                Math.min(
                  targetRect.top + targetRect.height / 2 - containerRect.top,
                  targetCardRect.bottom - containerRect.top
                )
              )

              newLines.push({
                id: conn.id,
                x1,
                y1,
                x2,
                y2,
                color: getColor(conn.id),
              })
            }
            else {
              console.log('ConnectionLines: Missing element for connection', {
                connId: conn.id,
                sourceId: conn.sourceId,
                targetId: conn.targetId,
                sourceFound: !!sourceElement,
                targetFound: !!targetElement
              })
            }
          }
        }

      })

      setLines(newLines)
    }

    updateLines()

    // Update lines on scroll or resize
    const container = containerRef.current
    if (container) {
      // Find scrollable containers using class selector - check for both overflow-auto and overflow-y-auto
      const scrollContainers = container.querySelectorAll('.overflow-auto, .overflow-y-auto')

      scrollContainers.forEach((el) => {
        el.addEventListener("scroll", updateLines, { passive: true })
      })

      window.addEventListener("resize", updateLines)

      // Also update when DOM changes (expand/collapse nodes)
      const observer = new MutationObserver(() => {
        // Debounce to avoid too many updates
        requestAnimationFrame(updateLines)
      })
      observer.observe(container, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style']
      })

      return () => {
        scrollContainers.forEach((el) => {
          el.removeEventListener("scroll", updateLines)
        })
        window.removeEventListener("resize", updateLines)
        observer.disconnect()
      }
    }
  }, [connections, containerRef, getConnectionColor])

  // Always render SVG, even with no lines
  return (
    <svg
      className="absolute inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 10, width: '100%', height: '100%' }}
    >
      {lines.map((line) => {
        // line.color already contains the full oklch() value
        return (
          <g key={line.id}>
            <path
              d={`M ${line.x1} ${line.y1} C ${!isMobile ? line.x1 + 50 :line.x1 - 50} ${line.y1}, ${line.x2 - 50} ${line.y2}, ${line.x2} ${line.y2}`}
              stroke={line.color}
              strokeWidth="4px"
              fill="none"
              opacity="1"
            />
            {/* <circle cx={line.x1} cy={line.y1} r="4" fill={line.color} opacity="0.8" />
            <circle cx={line.x2} cy={line.y2} r="4" fill={line.color} opacity="0.8" /> */}
          </g>
        )
      })}
    </svg>
  )
}
